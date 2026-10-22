<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist';
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { holdWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { PreloadAdmission, SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  const wakeOwners = new Set<ReturnType<typeof holdWakeLock>>();

  function releaseOwnedWakeLocks() {
    for (const owner of wakeOwners) owner.release();
    wakeOwners.clear();
  }

  onDestroy(releaseOwnedWakeLocks);

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;

  type State = 'idle' | 'rendering' | 'editing' | 'running' | 'done' | 'error';

  interface DrawRect {
    /** 1-indexed page number. */
    page: number;
    /** Fractions of the rendered canvas, with a top-left origin. */
    canvasX: number;
    canvasY: number;
    canvasW: number;
    canvasH: number;
    pdf: { page: number; x: number; y: number; width: number; height: number };
  }

  interface RenderedPage {
    page: number;
    generation: number;
    renderGeneration: number;
    pdf: PDFDocumentProxy;
    canvas: HTMLCanvasElement;
    viewport: ReturnType<PDFPageProxy['getViewport']>;
    width: number;
    height: number;
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
  let previousCloseWarning = '';

  let pdfDoc: PDFDocumentProxy | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let renderTask: RenderTask | null = null;
  let generation = 0;
  let renderGeneration = 0;
  let disposed = false;
  let controller: AbortController | null = null;
  let attemptedFile: File | null = null;
  let seenPreload = preloadedFile;
  let originalFile: File | null = preloadedFile;
  const recoveryUrls = new Set<string>();
  let pageCount = 0;
  let currentPage = 1;
  let renderedPage: RenderedPage | null = null;

  let canvasEl: HTMLCanvasElement;
  let overlayEl: HTMLDivElement;
  let rectangles: DrawRect[] = [];
  let colorChoice = 'black';

  // Drawing state
  let drawing = false;
  let dragStart: { x: number; y: number } | null = null;
  let dragCurrent: { x: number; y: number } | null = null;
  let drawingPointer: { id: number; rendered: RenderedPage } | null = null;

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;

  $: if (preloadedFile && preloadedFile !== seenPreload) {
    seenPreload = preloadedFile;
    onFiles(new CustomEvent('files', { detail: [preloadedFile] }));
  }

  $: if (files[0] && files[0] !== attemptedFile) {
    attemptedFile = files[0];
    void loadPdf(files[0]);
  }

  $: pageRectangles = rectangles.filter((r) => r.page === currentPage);

  function onFiles(e: CustomEvent<File[]>) {
    closePdf(); attemptedFile = null;
    files = e.detail;
    originalFile = files[0] ?? originalFile;
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

  function cancelRender() {
    cancelGesture();
    renderedPage = null;
    renderGeneration++;
    const task = renderTask; renderTask = null;
    task?.cancel();
  }

  function closePdf() {
    generation++; controller?.abort(); controller = null; cancelRender();
    const task = loadingTask; loadingTask = null; pdfDoc = null;
    if (task) void task.destroy().catch(() => { if (!disposed) previousCloseWarning = 'Could not close the previous PDF reader.'; });
  }

  async function loadPdf(file: File) {
    closePdf(); attemptedFile = file; originalFile = file;
    const own = generation;
    state = 'rendering';
    errorMsg = '';
    try {
      if (tool.input.sizeLimit !== undefined && file.size > tool.input.sizeLimit) throw new Error('PDF exceeds this tool\'s size limit.');
      const { getDocument, GlobalWorkerOptions } = await import(
        'pdfjs-dist/legacy/build/pdf.mjs'
      );
      if (disposed || generation !== own || files[0] !== file) return;
      // Worker: use the bundled worker from pdfjs-dist via vite resolution.
      if (!GlobalWorkerOptions.workerSrc) {
        const workerUrl = (await import(
          'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
        )) as { default: string };
        GlobalWorkerOptions.workerSrc = workerUrl.default;
      }
      const buffer = await file.arrayBuffer();
      if (disposed || generation !== own || files[0] !== file) return;
      if (tool.input.sizeLimit !== undefined && buffer.byteLength > tool.input.sizeLimit) throw new Error('PDF exceeds this tool\'s size limit.');
      const task = getDocument({ data: new Uint8Array(buffer) }); loadingTask = task;
      const pdf = await task.promise;
      if (disposed || generation !== own || files[0] !== file) return;
      pdfDoc = pdf;
      pageCount = pdf.numPages;
      currentPage = 1;
      if (!await renderPage(own)) return;
      if (disposed || generation !== own || files[0] !== file) return;
      state = 'editing';
      if (file === preloadedFile) onPreloadAdmission?.({ file, status: 'admitted' });
    } catch (err) {
      if (!disposed && generation === own && files[0] === file) {
        state = 'error'; errorMsg = err instanceof Error ? err.message : String(err);
        if (file === preloadedFile) onPreloadAdmission?.({ file, status: 'refused', message: errorMsg });
      }
    }
  }

  async function renderPage(own = generation): Promise<boolean> {
    cancelRender(); const renderOwn = renderGeneration;
    const pdf = pdfDoc; const requestedPage = currentPage;
    if (!pdf) throw new Error('PDF reader unavailable.');
    await tick();
    if (disposed || generation !== own || renderGeneration !== renderOwn || pdfDoc !== pdf) return false;
    const canvas = canvasEl;
    if (!canvas) throw new Error('PDF editing canvas unavailable.');
    const page = await pdf.getPage(requestedPage);
    if (disposed || generation !== own || renderGeneration !== renderOwn || currentPage !== requestedPage) return false;
    const unscaled = page.getViewport({ scale: 1 });
    if (!Number.isFinite(unscaled.width) || !Number.isFinite(unscaled.height) || unscaled.width <= 0 || unscaled.height <= 0) throw new Error('Invalid PDF page dimensions.');
    // Fit width to ~720 px; recompute scale so on different page sizes we
    // get a consistent on-screen size.
    const targetWidth = 720;
    const viewportScale = targetWidth / unscaled.width;
    const viewport = page.getViewport({ scale: viewportScale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 1 || canvas.height < 1) throw new Error('PDF canvas could not be initialized.');
    const task = page.render({ canvas, canvasContext: ctx, viewport }); renderTask = task;
    try { await task.promise; }
    catch (cause) {
      if (disposed || generation !== own || renderGeneration !== renderOwn) return false;
      throw cause;
    }
    if (disposed || generation !== own || renderGeneration !== renderOwn || currentPage !== requestedPage || canvasEl !== canvas) return false;
    renderTask = null;
    renderedPage = { page: requestedPage, generation: own, renderGeneration: renderOwn, pdf, canvas, viewport, width: canvas.width, height: canvas.height };
    return true;
  }

  async function gotoPage(n: number) {
    if (n < 1 || n > pageCount || state !== 'editing') return;
    currentPage = n;
    state = 'rendering'; const own = generation;
    try { if (await renderPage(own) && generation === own && !disposed) state = 'editing'; }
    catch (cause) { if (generation === own && !disposed) { state = 'error'; errorMsg = cause instanceof Error ? cause.message : 'Could not render this page.'; } }
  }

  function relativePoint(e: PointerEvent, rendered: RenderedPage): { x: number; y: number } | null {
    const rect = rendered.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)) * rendered.width / rect.width,
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)) * rendered.height / rect.height,
    };
  }

  function currentRender(rendered: RenderedPage): boolean {
    return !disposed && state === 'editing' && renderedPage === rendered && generation === rendered.generation && renderGeneration === rendered.renderGeneration && currentPage === rendered.page && pdfDoc === rendered.pdf && canvasEl === rendered.canvas;
  }

  function cancelGesture(e?: PointerEvent) {
    const pointer = drawingPointer;
    if (e && pointer && e.pointerId !== pointer.id) return;
    drawingPointer = null; drawing = false; dragStart = null; dragCurrent = null;
    if (pointer && overlayEl?.hasPointerCapture(pointer.id)) overlayEl.releasePointerCapture(pointer.id);
  }

  function onPointerDown(e: PointerEvent) {
    const rendered = renderedPage;
    if (e.button !== 0 || drawingPointer || !rendered || !currentRender(rendered)) return;
    const point = relativePoint(e, rendered);
    if (!point) return;
    overlayEl.setPointerCapture(e.pointerId);
    drawingPointer = { id: e.pointerId, rendered };
    drawing = true;
    dragStart = point;
    dragCurrent = dragStart;
  }

  function onPointerMove(e: PointerEvent) {
    const pointer = drawingPointer;
    if (!pointer || pointer.id !== e.pointerId || !dragStart) return;
    if (!currentRender(pointer.rendered)) { cancelGesture(); return; }
    dragCurrent = relativePoint(e, pointer.rendered);
  }

  function onPointerUp(e: PointerEvent) {
    const pointer = drawingPointer;
    if (!pointer || pointer.id !== e.pointerId || !dragStart) return;
    if (!currentRender(pointer.rendered)) { cancelGesture(); return; }
    dragCurrent = relativePoint(e, pointer.rendered);
    if (!dragCurrent) { cancelGesture(); return; }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    // Ignore tiny accidental clicks.
    const rendered = pointer.rendered;
    const displayed = rendered.canvas.getBoundingClientRect();
    if (w * displayed.width / rendered.width >= 4 && h * displayed.height / rendered.height >= 4) {
      const a = rendered.viewport.convertToPdfPoint(x, y);
      const b = rendered.viewport.convertToPdfPoint(x + w, y + h);
      const pdf = { page: rendered.page, x: Math.min(a[0]!, b[0]!), y: Math.min(a[1]!, b[1]!), width: Math.abs(b[0]! - a[0]!), height: Math.abs(b[1]! - a[1]!) };
      rectangles = [
        ...rectangles,
        { page: rendered.page, canvasX: x / rendered.width, canvasY: y / rendered.height, canvasW: w / rendered.width, canvasH: h / rendered.height, pdf },
      ];
    }
    cancelGesture();
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

  async function run() {
    if (rectangles.length === 0 || state !== 'editing') return;
    const own = generation; const input = files;
    const abort = new AbortController(); controller = abort;
    state = 'running';
    errorMsg = '';

    const wake = holdWakeLock();
    wakeOwners.add(wake);
    try {
      const { createDefaultRegistry } = await import('../../lib/core-execution');
      if (disposed || generation !== own) return;
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const preset = COLOR_PRESETS.find((p) => p.value === colorChoice) ?? COLOR_PRESETS[0]!;

      const result = await toolModule.run(input, {
        rectangles: rectangles.map(r => ({ ...r.pdf })),
        color: preset.rgb,
      }, {
        onProgress: (p) => { if (!disposed && generation === own) progress = p; },
        signal: abort.signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      if (disposed || generation !== own) return;

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      if (!disposed && generation === own) { state = 'error'; errorMsg = err instanceof Error ? err.message : String(err); }
    } finally {
      wake.release();
      wakeOwners.delete(wake);
      if (generation === own) controller = null;
    }
  }

  function reset() {
    generation++; controller?.abort(); controller = null; cancelRender();
    releaseOwnedWakeLocks();
    state = pdfDoc ? 'rendering' : 'idle';
    if (pdfDoc) {
      const own = generation;
      void renderPage(own).then((rendered) => { if (rendered && !disposed && generation === own) state = 'editing'; })
        .catch((cause) => { if (!disposed && generation === own) { state = 'error'; errorMsg = cause instanceof Error ? cause.message : 'Could not render this page.'; } });
    }
    errorMsg = '';
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  function downloadOriginal() {
    if (!originalFile) return;
    const url = URL.createObjectURL(originalFile); recoveryUrls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = originalFile.name; link.click();
  }
  function retryOriginal() { if (originalFile) onFiles(new CustomEvent('files', { detail: [originalFile] })); }
  function dismissOriginal() { originalFile = null; onFiles(new CustomEvent('files', { detail: [] })); }
  onDestroy(() => { disposed = true; closePdf(); if (resultUrl) URL.revokeObjectURL(resultUrl); for (const url of recoveryUrls) URL.revokeObjectURL(url); recoveryUrls.clear(); });

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
          x: Math.min(dragStart.x, dragCurrent.x) / drawingPointer!.rendered.width,
          y: Math.min(dragStart.y, dragCurrent.y) / drawingPointer!.rendered.height,
          w: Math.abs(dragCurrent.x - dragStart.x) / drawingPointer!.rendered.width,
          h: Math.abs(dragCurrent.y - dragStart.y) / drawingPointer!.rendered.height,
        }
      : null;

  $: previewColor =
    (COLOR_PRESETS.find((p) => p.value === colorChoice) ?? COLOR_PRESETS[0]!).rgb;
</script>

<div class="runner">
  {#if previousCloseWarning}<p role="status">{previousCloseWarning}</p>{/if}
  <p>Visual cover only. Underlying text and images can remain recoverable. Compress PDF does not make this secure redaction. Do not use this output to securely remove confidential content.</p>
  {#if originalFile}<p>Original PDF: {originalFile.name}.</p><div class="actions"><button type="button" class="btn-secondary" on:click={downloadOriginal}>Download original</button><button type="button" class="btn-secondary" on:click={retryOriginal}>Retry original</button><button type="button" class="btn-secondary" on:click={dismissOriginal}>Dismiss original</button></div>{/if}
  {#if state === 'idle' || files.length === 0}
    <DropZone
      accept={tool.input.accept}
      sizeLimit={tool.input.sizeLimit}
      multiple={false}
      bind:files
      bind:error={dropError}
      on:files={onFiles}
    />
  {/if}

  {#if state === 'rendering'}
    <ProgressBar stage="processing" percent={50} message="Loading PDF" />
    <button type="button" class="btn-secondary" on:click={() => { closePdf(); state = 'idle'; }}>Cancel PDF loading</button>
  {/if}

  {#if state === 'editing' || state === 'running' || (state === 'rendering' && pdfDoc)}
    <div class="redact-toolbar">
      <div class="page-nav">
        <button class="btn-secondary" on:click={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1 || state !== 'editing'} type="button" aria-label="Previous page">‹</button>
        <span class="page-count">page {currentPage} / {pageCount}</span>
        <button class="btn-secondary" on:click={() => gotoPage(currentPage + 1)} disabled={currentPage >= pageCount || state !== 'editing'} type="button" aria-label="Next page">›</button>
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
  {/if}

  {#if pdfDoc}
    <div class="canvas-stage" hidden={state !== 'editing' && state !== 'running'}>
      <canvas bind:this={canvasEl} class="pdf-canvas"></canvas>
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        bind:this={overlayEl}
        class="draw-overlay"
        class:drawing
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={cancelGesture}
        on:lostpointercapture={cancelGesture}
      >
        {#each pageRectangles as r}
          <button
            class="rect-existing"
            type="button"
            style="left:{r.canvasX * 100}%; top:{r.canvasY * 100}%; width:{r.canvasW * 100}%; height:{r.canvasH * 100}%; background: rgba({previewColor[0] * 255},{previewColor[1] * 255},{previewColor[2] * 255}, 0.85);"
            aria-label="Delete redaction rectangle"
            on:click={() => deleteRect(r)}
            on:pointerdown|stopPropagation
          ></button>
        {/each}
        {#if liveRect}
          <div
            class="rect-live"
            style="left:{liveRect.x * 100}%; top:{liveRect.y * 100}%; width:{liveRect.w * 100}%; height:{liveRect.h * 100}%; background: rgba({previewColor[0] * 255},{previewColor[1] * 255},{previewColor[2] * 255}, 0.5);"
          ></div>
        {/if}
      </div>
    </div>
  {/if}

  {#if state === 'editing' || state === 'running'}
    <p class="hint">Drag on the page to draw a redaction rectangle. Click an existing rectangle to delete it.</p>

    {#if state !== 'running'}
      <button class="btn-primary" on:click={run} disabled={rectangles.length === 0 || state !== 'editing'} type="button">
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
      <button class="btn-secondary" on:click={retryOriginal} type="button">Try again</button>
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
