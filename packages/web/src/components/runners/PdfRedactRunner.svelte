<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { acquireWakeLock, releaseWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  type State = 'idle' | 'rendering' | 'editing' | 'running' | 'done' | 'error';

  interface DrawRect {
    /** 1-indexed page number. */
    page: number;
    /** Canvas-space rectangle (px, top-left origin). */
    canvasX: number;
    canvasY: number;
    canvasW: number;
    canvasH: number;
  }

  // Color presets — keep simple. Custom hex picker would be next iteration.
  const COLOR_PRESETS = [
    { value: 'black', label: 'black', rgb: [0, 0, 0] as [number, number, number] },
    { value: 'white', label: 'white', rgb: [1, 1, 1] as [number, number, number] },
    { value: 'red', label: 'red', rgb: [0.86, 0.16, 0.16] as [number, number, number] },
  ];

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';

  let pdfDoc: unknown = null;
  let pageCount = 0;
  let currentPage = 1;
  // Rendered viewport scale (canvas px / PDF pt). Filled per-render.
  let viewportScale = 1.5;
  let pageWidthPt = 0;
  let pageHeightPt = 0;

  let canvasEl: HTMLCanvasElement;
  let overlayEl: HTMLDivElement;
  let rectangles: DrawRect[] = [];
  let colorChoice = 'black';

  // Drawing state
  let drawing = false;
  let dragStart: { x: number; y: number } | null = null;
  let dragCurrent: { x: number; y: number } | null = null;

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }

  $: if (files.length > 0 && !pdfDoc && state !== 'rendering') {
    void loadPdf();
  }

  $: pageRectangles = rectangles.filter((r) => r.page === currentPage);

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    pdfDoc = null;
    pageCount = 0;
    currentPage = 1;
    rectangles = [];
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  async function loadPdf() {
    state = 'rendering';
    errorMsg = '';
    try {
      const { getDocument, GlobalWorkerOptions } = await import(
        'pdfjs-dist/legacy/build/pdf.mjs'
      );
      // Worker: use the bundled worker from pdfjs-dist via vite resolution.
      if (!GlobalWorkerOptions.workerSrc) {
        const workerUrl = (await import(
          'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
        )) as { default: string };
        GlobalWorkerOptions.workerSrc = workerUrl.default;
      }
      const buffer = await files[0]!.arrayBuffer();
      const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
      pdfDoc = pdf;
      pageCount = pdf.numPages;
      currentPage = 1;
      await renderPage();
      state = 'editing';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  async function renderPage() {
    if (!pdfDoc || !canvasEl) return;
    const pdf = pdfDoc as {
      getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => {
          width: number;
          height: number;
        };
        view: number[];
        render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
      }>;
    };
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    // Fit width to ~720 px; recompute scale so on different page sizes we
    // get a consistent on-screen size.
    const targetWidth = 720;
    viewportScale = targetWidth / unscaled.width;
    const viewport = page.getViewport({ scale: viewportScale });
    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Page dimensions in PDF points (view = [x0,y0,x1,y1]).
    pageWidthPt = page.view[2]! - page.view[0]!;
    pageHeightPt = page.view[3]! - page.view[1]!;
  }

  async function gotoPage(n: number) {
    if (n < 1 || n > pageCount) return;
    currentPage = n;
    await renderPage();
  }

  function relativePoint(e: MouseEvent | PointerEvent): { x: number; y: number } {
    const rect = overlayEl.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    overlayEl.setPointerCapture(e.pointerId);
    drawing = true;
    dragStart = relativePoint(e);
    dragCurrent = dragStart;
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing || !dragStart) return;
    dragCurrent = relativePoint(e);
  }

  function onPointerUp(e: PointerEvent) {
    if (!drawing || !dragStart || !dragCurrent) return;
    overlayEl.releasePointerCapture(e.pointerId);
    drawing = false;
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    // Ignore tiny accidental clicks.
    if (w >= 4 && h >= 4) {
      rectangles = [
        ...rectangles,
        { page: currentPage, canvasX: x, canvasY: y, canvasW: w, canvasH: h },
      ];
    }
    dragStart = null;
    dragCurrent = null;
  }

  function deleteRect(target: DrawRect) {
    rectangles = rectangles.filter((r) => r !== target);
  }

  function clearPage() {
    rectangles = rectangles.filter((r) => r.page !== currentPage);
  }

  function clearAll() {
    rectangles = [];
  }

  /**
   * Convert a canvas-space rectangle (top-left origin, scaled) to a PDF
   * rectangle (bottom-left origin, points).
   */
  function canvasToPdfRect(r: DrawRect): {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const widthPt = r.canvasW / viewportScale;
    const heightPt = r.canvasH / viewportScale;
    const xPt = r.canvasX / viewportScale;
    // Y-flip: canvas origin top-left, PDF origin bottom-left.
    const yPt = pageHeightPt - r.canvasY / viewportScale - heightPt;
    return { page: r.page, x: xPt, y: yPt, width: widthPt, height: heightPt };
  }

  async function run() {
    if (rectangles.length === 0) return;
    state = 'running';
    errorMsg = '';

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const preset = COLOR_PRESETS.find((p) => p.value === colorChoice) ?? COLOR_PRESETS[0]!;

      const result = await toolModule.run(files, {
        rectangles: rectangles.map(canvasToPdfRect),
        color: preset.rgb,
      }, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      releaseWakeLock();
    }
  }

  function reset() {
    state = pdfDoc ? 'editing' : 'idle';
    errorMsg = '';
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  function download() {
    if (!resultUrl || !resultBlob) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = buildDownloadName(files[0]?.name, tool.id, 'pdf');
    a.click();
  }

  $: liveRect =
    drawing && dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          w: Math.abs(dragCurrent.x - dragStart.x),
          h: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  $: previewColor =
    (COLOR_PRESETS.find((p) => p.value === colorChoice) ?? COLOR_PRESETS[0]!).rgb;
</script>

<div class="runner">
  {#if state === 'idle' || files.length === 0}
    <DropZone
      accept={tool.input.accept}
      multiple={false}
      bind:files
      bind:error={dropError}
      on:files={onFiles}
    />
  {/if}

  {#if state === 'rendering'}
    <ProgressBar stage="processing" percent={50} message="Loading PDF" />
  {/if}

  {#if state === 'editing' || state === 'running'}
    <div class="redact-toolbar">
      <div class="page-nav">
        <button class="btn-secondary" on:click={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} type="button" aria-label="Previous page">‹</button>
        <span class="page-count">page {currentPage} / {pageCount}</span>
        <button class="btn-secondary" on:click={() => gotoPage(currentPage + 1)} disabled={currentPage >= pageCount} type="button" aria-label="Next page">›</button>
      </div>
      <div class="color-picker" role="group" aria-label="Redaction color">
        <span class="color-label">color</span>
        {#each COLOR_PRESETS as c}
          <label class="color-chip" class:color-chip--active={colorChoice === c.value}>
            <input type="radio" name="color" value={c.value} bind:group={colorChoice} class="sr-only" />
            <span class="color-swatch" style="background: rgb({c.rgb[0] * 255}, {c.rgb[1] * 255}, {c.rgb[2] * 255})" aria-hidden="true"></span>
            <span>{c.label}</span>
          </label>
        {/each}
      </div>
      <div class="rect-controls">
        <span class="rect-count">{rectangles.length} total · {pageRectangles.length} on this page</span>
        <button class="btn-ghost-sm" on:click={clearPage} disabled={pageRectangles.length === 0} type="button">Clear page</button>
        <button class="btn-ghost-sm" on:click={clearAll} disabled={rectangles.length === 0} type="button">Clear all</button>
      </div>
    </div>

    <div class="canvas-stage">
      <canvas bind:this={canvasEl} class="pdf-canvas"></canvas>
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        bind:this={overlayEl}
        class="draw-overlay"
        class:drawing
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
      >
        {#each pageRectangles as r}
          <button
            class="rect-existing"
            type="button"
            style="left:{r.canvasX}px; top:{r.canvasY}px; width:{r.canvasW}px; height:{r.canvasH}px; background: rgba({previewColor[0] * 255},{previewColor[1] * 255},{previewColor[2] * 255}, 0.85);"
            aria-label="Delete redaction rectangle"
            on:click={() => deleteRect(r)}
            on:pointerdown|stopPropagation
          ></button>
        {/each}
        {#if liveRect}
          <div
            class="rect-live"
            style="left:{liveRect.x}px; top:{liveRect.y}px; width:{liveRect.w}px; height:{liveRect.h}px; background: rgba({previewColor[0] * 255},{previewColor[1] * 255},{previewColor[2] * 255}, 0.5);"
          ></div>
        {/if}
      </div>
    </div>

    <p class="hint">Drag on the page to draw a redaction rectangle. Click an existing rectangle to delete it.</p>

    {#if state !== 'running'}
      <button class="btn-primary" on:click={run} disabled={rectangles.length === 0} type="button">
        Apply {rectangles.length} redaction{rectangles.length === 1 ? '' : 's'}
      </button>
    {/if}
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert">
      <div class="panel-header"><span class="panel-label error-label">Error</span></div>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" on:click={reset} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && resultBlob}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
          <div class="result-actions">
            <button class="btn-secondary" on:click={download} type="button">Download</button>
            <button class="btn-secondary" on:click={reset} type="button">Edit again</button>
          </div>
        </div>
        <div class="panel-divider"></div>
        <p class="done-msg">PDF redacted with {rectangles.length} rectangle{rectangles.length === 1 ? '' : 's'} across {new Set(rectangles.map((r) => r.page)).size} page{new Set(rectangles.map((r) => r.page)).size === 1 ? '' : 's'}.</p>
        <ChainSection
          resultBlob={resultBlob}
          sourceToolId={tool.id}
          resultName={buildDownloadName(files[0]?.name, tool.id, 'pdf')}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

  .redact-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .page-nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .page-count {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 100px;
    text-align: center;
  }

  .color-picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .color-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .color-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
    background: var(--bg-raised);
  }

  .color-chip--active {
    border-color: var(--accent-hover);
    color: var(--accent-text);
  }

  .color-swatch {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid var(--border-subtle);
    display: inline-block;
  }

  .rect-controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
  }

  .rect-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .canvas-stage {
    position: relative;
    align-self: flex-start;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    line-height: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .pdf-canvas {
    display: block;
    max-width: 100%;
  }

  .draw-overlay {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }

  .draw-overlay.drawing {
    cursor: crosshair;
  }

  .rect-existing {
    position: absolute;
    border: 1px solid var(--border);
    cursor: pointer;
    padding: 0;
    color: transparent;
    transition: outline var(--duration-instant) var(--ease-sharp);
  }

  .rect-existing:hover {
    outline: 2px solid var(--accent-hover);
    outline-offset: 1px;
  }

  .rect-existing:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .rect-live {
    position: absolute;
    border: 1px dashed var(--text-muted);
    pointer-events: none;
  }

  .hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin: 0;
  }

  .btn-primary {
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    align-self: flex-start;
    transition: background var(--duration-instant) var(--ease-sharp), transform var(--duration-instant) var(--ease-sharp);
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-secondary {
    height: 28px;
    padding: 0 var(--space-2);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-ghost-sm {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }
  .btn-ghost-sm:hover:not(:disabled) { color: var(--text-muted); }
  .btn-ghost-sm:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; overflow: visible; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .result-actions { display: flex; gap: var(--space-2); }
  .done-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); margin: 0; }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }

  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
</style>
