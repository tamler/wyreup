<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist';
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
  // One DrawRect per page — keyed by page number. Drawing on a page
  // replaces the existing box for that page.
  let rectsByPage = new Map<number, DrawRect>();
  let applyToAllPages = true;

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

  $: currentRect = rectsByPage.get(currentPage) ?? null;
  $: hasAnyRect = rectsByPage.size > 0;
  $: uniformSourcePage = rectsByPage.values().next().value?.page;

  function onFiles(e: CustomEvent<File[]>) {
    closePdf();
    attemptedFile = null;
    files = e.detail;
    originalFile = files[0] ?? originalFile;
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
      if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
        GlobalWorkerOptions.workerSrc =
          new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
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
    const rendered = pointer.rendered;
    const displayed = rendered.canvas.getBoundingClientRect();
    if (w * displayed.width / rendered.width >= 4 && h * displayed.height / rendered.height >= 4) {
      const a = rendered.viewport.convertToPdfPoint(x, y);
      const b = rendered.viewport.convertToPdfPoint(x + w, y + h);
      const pdf = { page: rendered.page, x: Math.min(a[0]!, b[0]!), y: Math.min(a[1]!, b[1]!), width: Math.abs(b[0]! - a[0]!), height: Math.abs(b[1]! - a[1]!) };
      const next = new Map(rectsByPage);
      next.set(rendered.page, { page: rendered.page, canvasX: x / rendered.width, canvasY: y / rendered.height, canvasW: w / rendered.width, canvasH: h / rendered.height, pdf });
      rectsByPage = next;
    }
    cancelGesture();
  }

  function clearCurrentPage() {
    const next = new Map(rectsByPage);
    next.delete(currentPage);
    rectsByPage = next;
  }

  function clearAll() {
    rectsByPage = new Map();
  }

  async function run() {
    if (!hasAnyRect || state !== 'editing') return;
    const own = generation; const input = [...files]; const pdf = pdfDoc;
    const selected = Array.from(rectsByPage.values(), r => ({ ...r.pdf }));
    const uniform = applyToAllPages;
    const abort = new AbortController(); controller = abort;
    state = 'running';
    errorMsg = '';

    const wake = holdWakeLock();
    wakeOwners.add(wake);
    try {
      let box = selected;
      if (uniform) {
        if (!pdf) throw new Error('PDF reader unavailable.');
        if (pdf.numPages > 2000) throw new Error('PDF exceeds the 2000-page crop limit.');
        const first = selected[0]!;
        box = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (disposed || generation !== own || abort.signal.aborted || controller !== abort || pdfDoc !== pdf || files[0] !== input[0]) return;
          const x = Math.max(first.x, page.view[0]!);
          const y = Math.max(first.y, page.view[1]!);
          const right = Math.min(first.x + first.width, page.view[2]!);
          const top = Math.min(first.y + first.height, page.view[3]!);
          if (right <= x || top <= y) {
            state = 'editing';
            errorMsg = `The crop box does not intersect page ${n}. Draw a different box or turn off Apply to all pages.`;
            return;
          }
          box.push({ page: n, x, y, width: right - x, height: top - y });
        }
      }
      const { createDefaultRegistry } = await import('../../lib/core-execution');
      if (disposed || generation !== own || abort.signal.aborted || controller !== abort || pdfDoc !== pdf || files[0] !== input[0]) return;
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run(input, { box }, {
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
      if (!disposed && generation === own && !abort.signal.aborted && pdfDoc === pdf && files[0] === input[0]) { state = 'error'; errorMsg = err instanceof Error ? err.message : String(err); }
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
</script>

<div class="runner">
  {#if previousCloseWarning}<p role="status">{previousCloseWarning}</p>{/if}
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
    <div class="crop-toolbar">
      <div class="page-nav">
        <button class="btn-secondary" on:click={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1 || state !== 'editing'} type="button" aria-label="Previous page">‹</button>
        <span class="page-count">page {currentPage} / {pageCount}</span>
        <button class="btn-secondary" on:click={() => gotoPage(currentPage + 1)} disabled={currentPage >= pageCount || state !== 'editing'} type="button" aria-label="Next page">›</button>
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
        Drag on the page to set a crop box. {#if uniformSourcePage}Using the box drawn on page {uniformSourcePage}. {/if}The same PDF coordinates are clipped to each page's visible area.
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
        on:pointercancel={cancelGesture}
        on:lostpointercapture={cancelGesture}
      >
        {#if currentRect}
          <div
            class="rect-existing"
            style="left:{currentRect.canvasX * 100}%; top:{currentRect.canvasY * 100}%; width:{currentRect.canvasW * 100}%; height:{currentRect.canvasH * 100}%;"
            aria-hidden="true"
          ></div>
        {/if}
        {#if liveRect}
          <div
            class="rect-live"
            style="left:{liveRect.x * 100}%; top:{liveRect.y * 100}%; width:{liveRect.w * 100}%; height:{liveRect.h * 100}%;"
            aria-hidden="true"
          ></div>
        {/if}
      </div>
    </div>

    {#if state === 'editing' && errorMsg}<div class="error" role="alert">{errorMsg}</div>{/if}
    <div class="actions">
      <button class="btn-primary" type="button" on:click={run} disabled={!hasAnyRect || state !== 'editing'}>
        {state === 'running' ? 'Cropping...' : 'Crop PDF'}
      </button>
    </div>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error" role="alert">{errorMsg}</div>
    <button class="btn-secondary" type="button" on:click={retryOriginal}>Try again</button>
  {/if}

  {#if state === 'done' && resultBlob && resultUrl}
    <div class="result">
      <p class="result-summary">Cropped — output is {(resultBlob.size / 1024).toFixed(1)} KB.</p>
      <div class="result-actions">
        <button class="btn-primary" type="button" on:click={download}>Download</button>
        <button class="btn-secondary" type="button" on:click={reset}>Edit again</button>
      </div>
      <ChainSection resultBlob={resultBlob} sourceToolId={tool.id} resultName={buildDownloadName(files[0]?.name, tool.id, 'pdf')} />
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
  .pdf-canvas { display: block; max-width: 100%; height: auto; background: white; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); }
  .draw-overlay { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
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
