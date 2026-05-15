<script lang="ts">
  // Visual crop-box editor for pdf-crop. Mirrors PdfRedactRunner's canvas
  // + drag-to-draw pattern but with single-rectangle-per-page semantics:
  // drawing replaces the current page's box, no accumulation. Optional
  // "apply to all pages" toggle sends a single box to the tool; otherwise
  // we send a per-page array.
  //
  // Replaces the generic PreviewRunner + JSON-textarea fallback, which
  // was the most-complained friction in the catalog. Roadmap "Now" #2.

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

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';

  let pdfDoc: unknown = null;
  let pageCount = 0;
  let currentPage = 1;
  let viewportScale = 1.5;
  let pageWidthPt = 0;
  let pageHeightPt = 0;

  let canvasEl: HTMLCanvasElement;
  let overlayEl: HTMLDivElement;
  // One DrawRect per page — keyed by page number. Drawing on a page
  // replaces the existing box for that page.
  let rectsByPage = new Map<number, DrawRect>();
  let applyToAllPages = true;

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

  $: currentRect = rectsByPage.get(currentPage) ?? null;
  $: hasAnyRect = rectsByPage.size > 0;

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    pdfDoc = null;
    pageCount = 0;
    currentPage = 1;
    rectsByPage = new Map();
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  async function loadPdf() {
    if (files.length === 0) return;
    state = 'rendering';
    try {
      const { getDocument, GlobalWorkerOptions } = await import(
        'pdfjs-dist/legacy/build/pdf.mjs'
      );
      if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
        GlobalWorkerOptions.workerSrc =
          new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
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
        getViewport: (opts: { scale: number }) => { width: number; height: number };
        view: number[];
        render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
      }>;
    };
    const page = await pdf.getPage(currentPage);
    const unscaled = page.getViewport({ scale: 1 });
    const targetWidth = 720;
    viewportScale = targetWidth / unscaled.width;
    const viewport = page.getViewport({ scale: viewportScale });
    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;
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
    if (w >= 4 && h >= 4) {
      const next = new Map(rectsByPage);
      next.set(currentPage, { page: currentPage, canvasX: x, canvasY: y, canvasW: w, canvasH: h });
      rectsByPage = next;
    }
    dragStart = null;
    dragCurrent = null;
  }

  function clearCurrentPage() {
    const next = new Map(rectsByPage);
    next.delete(currentPage);
    rectsByPage = next;
  }

  function clearAll() {
    rectsByPage = new Map();
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
    const yPt = pageHeightPt - r.canvasY / viewportScale - heightPt;
    return { page: r.page, x: xPt, y: yPt, width: widthPt, height: heightPt };
  }

  async function run() {
    if (!hasAnyRect) return;
    state = 'running';
    errorMsg = '';

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const allPdfRects = Array.from(rectsByPage.values()).map(canvasToPdfRect);
      // Apply-to-all uses a single box (the first one drawn — usually the
      // user is on page 1). Per-page uses the full array; pages without
      // a box are left uncropped by the tool.
      const box = applyToAllPages
        ? (() => {
            const r = allPdfRects[0]!;
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })()
        : allPdfRects;

      const result = await toolModule.run(files, { box }, {
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
    <div class="crop-toolbar">
      <div class="page-nav">
        <button class="btn-secondary" on:click={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} type="button" aria-label="Previous page">‹</button>
        <span class="page-count">page {currentPage} / {pageCount}</span>
        <button class="btn-secondary" on:click={() => gotoPage(currentPage + 1)} disabled={currentPage >= pageCount} type="button" aria-label="Next page">›</button>
      </div>
      <label class="apply-toggle">
        <input type="checkbox" bind:checked={applyToAllPages} />
        <span>Apply to all pages</span>
      </label>
      <div class="rect-controls">
        <span class="rect-count">{rectsByPage.size} page{rectsByPage.size === 1 ? '' : 's'} marked</span>
        <button class="btn-ghost-sm" on:click={clearCurrentPage} disabled={!currentRect} type="button">Clear page</button>
        <button class="btn-ghost-sm" on:click={clearAll} disabled={!hasAnyRect} type="button">Clear all</button>
      </div>
    </div>

    <p class="hint">
      {#if applyToAllPages}
        Drag on the page to set a crop box. The same box will be applied to every page.
      {:else}
        Drag on each page to set its crop box. Pages you skip are left uncropped.
      {/if}
    </p>

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
        {#if currentRect}
          <div
            class="rect-existing"
            style="left:{currentRect.canvasX}px; top:{currentRect.canvasY}px; width:{currentRect.canvasW}px; height:{currentRect.canvasH}px;"
            aria-hidden="true"
          ></div>
        {/if}
        {#if liveRect}
          <div
            class="rect-live"
            style="left:{liveRect.x}px; top:{liveRect.y}px; width:{liveRect.w}px; height:{liveRect.h}px;"
            aria-hidden="true"
          ></div>
        {/if}
      </div>
    </div>

    <div class="actions">
      <button class="btn-primary" type="button" on:click={run} disabled={!hasAnyRect || state === 'running'}>
        {state === 'running' ? 'Cropping...' : 'Crop PDF'}
      </button>
    </div>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error" role="alert">{errorMsg}</div>
    <button class="btn-secondary" type="button" on:click={reset}>Try again</button>
  {/if}

  {#if state === 'done' && resultBlob && resultUrl}
    <div class="result">
      <p class="result-summary">Cropped — output is {(resultBlob.size / 1024).toFixed(1)} KB.</p>
      <div class="result-actions">
        <button class="btn-primary" type="button" on:click={download}>Download</button>
        <button class="btn-secondary" type="button" on:click={reset}>Edit again</button>
      </div>
      <ChainSection {tool} resultBlob={resultBlob} resultMime={resultBlob.type} />
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-3); }
  .crop-toolbar { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; padding: var(--space-2); background: var(--bg-raised); border-radius: var(--radius-md); }
  .page-nav { display: inline-flex; gap: var(--space-2); align-items: center; }
  .page-count { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); }
  .apply-toggle { display: inline-flex; gap: var(--space-1); align-items: center; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); cursor: pointer; }
  .rect-controls { display: inline-flex; gap: var(--space-2); align-items: center; margin-left: auto; }
  .rect-count { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }
  .hint { margin: 0; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }

  .canvas-stage { position: relative; align-self: flex-start; max-width: 100%; }
  .pdf-canvas { display: block; background: white; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); }
  .draw-overlay { position: absolute; inset: 0; cursor: crosshair; }
  .draw-overlay.drawing { cursor: crosshair; }

  .rect-existing {
    position: absolute;
    border: 2px dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }
  .rect-live {
    position: absolute;
    border: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    pointer-events: none;
  }

  .actions { display: flex; gap: var(--space-2); }
  .btn-primary, .btn-secondary, .btn-ghost-sm {
    height: 32px; padding: 0 var(--space-3); border-radius: var(--radius-md);
    font-family: var(--font-mono); font-size: var(--text-base); cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary { background: var(--accent); color: var(--black); border-color: var(--accent); font-weight: 500; }
  .btn-secondary { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border); }
  .btn-ghost-sm { height: 26px; padding: 0 var(--space-2); background: transparent; color: var(--text-subtle); border-color: var(--border); font-size: var(--text-xs); }
  .btn-primary[disabled], .btn-secondary[disabled], .btn-ghost-sm[disabled] { opacity: 0.4; cursor: not-allowed; }

  .error { padding: var(--space-2); background: color-mix(in srgb, var(--danger, #d22) 12%, transparent); color: var(--danger, #d22); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-sm); }

  .result { display: flex; flex-direction: column; gap: var(--space-3); }
  .result-summary { margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); }
  .result-actions { display: flex; gap: var(--space-2); }
</style>
