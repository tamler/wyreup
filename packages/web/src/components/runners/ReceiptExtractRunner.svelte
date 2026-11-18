<script lang="ts">
  import { onDestroy } from 'svelte';
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { holdWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import { tryReserveMediaJob } from '../../lib/mediaJobReservation';
  import type { SerializedTool, PreloadAdmission } from './types';
  import type { ToolProgress } from '@wyreup/core';
  import { parseReceiptResult, receiptCsv, receiptRows, type ReceiptExtractResult } from './receiptExtract';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  // Accepted for the shared runner interface; this tool has no file import.
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  $: void onPreloadAdmission;

  const TEXT_MAX = 6000;
  const PHOTO_MAX = tool.input.max ?? 4;
  const imageAccept = tool.input.accept.filter((m) => m.startsWith('image/'));

  let generation = 0;
  let disposed = false;
  const wakeOwners = new Set<ReturnType<typeof holdWakeLock>>();
  const downloadUrls = new Set<string>();
  onDestroy(() => {
    disposed = true;
    generation++;
    for (const w of wakeOwners) w.release();
    wakeOwners.clear();
    for (const url of downloadUrls) URL.revokeObjectURL(url);
  });

  let text = '';
  let photos: File[] = [];
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: ReceiptExtractResult | null = null;
  let resultBlob: Blob | null = null;
  let resultJson = '';
  let copied = false;

  $: if (preloadedFile) adoptPreload(preloadedFile);
  async function adoptPreload(file: File) {
    if (file.type.startsWith('image/')) photos = [file];
    else text = await file.text();
  }

  $: tooManyPhotos = photos.length > PHOTO_MAX;
  $: both = photos.length > 0 && text.trim().length > 0;
  $: hasInput = photos.length > 0 || text.trim().length > 0;
  $: canRun = hasInput && !both && !tooManyPhotos && text.length <= TEXT_MAX && state !== 'running';

  function clearResult() {
    generation++;
    state = 'idle';
    errorMsg = '';
    result = null;
    resultBlob = null;
    resultJson = '';
  }

  function onPhotos(e: CustomEvent<File[]>) {
    photos = e.detail;
    dropError = '';
    clearResult();
  }

  async function run() {
    if (!canRun) return;
    const lease = tryReserveMediaJob([tool.id]);
    if (!lease) {
      state = 'error';
      errorMsg = 'Another media job is still running. Your input is kept. Try again once it finishes.';
      return;
    }
    const attempt = ++generation;
    const current = () => !disposed && attempt === generation;
    const inputs = photos.length
      ? [...photos]
      : [new File([text.trim()], 'receipt.txt', { type: 'text/plain' })];
    state = 'running';
    errorMsg = '';
    const wake = holdWakeLock();
    wakeOwners.add(wake);
    try {
      const { createDefaultRegistry } = await import('../../lib/core-execution');
      const toolModule = createDefaultRegistry().toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);
      const out = await toolModule.run(inputs, {}, {
        onProgress: (p) => { if (current()) progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(out) ? out[0] : out;
      if (!blob) throw new Error('No output produced.');
      const json = await blob.text();
      const parsed = parseReceiptResult(json);
      if (!current()) return;
      result = parsed;
      resultBlob = blob;
      resultJson = JSON.stringify(parsed, null, 2);
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      if (!current()) return;
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      lease.release();
      wake.release();
      wakeOwners.delete(wake);
    }
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(resultJson);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch { /* clipboard unavailable */ }
  }

  function save(blob: Blob, ext: string) {
    const url = URL.createObjectURL(blob);
    downloadUrls.add(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildDownloadName(photos[0]?.name, tool.id, ext);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
  }

  $: rows = result ? receiptRows(result) : [];
</script>

<div class="runner">
  <label class="field-label" for="receipt-text">Paste receipt or invoice text</label>
  <textarea
    id="receipt-text"
    class="receipt-text"
    bind:value={text}
    on:input={clearResult}
    maxlength={TEXT_MAX}
    rows="7"
    placeholder="Paste the text of a receipt, invoice or bill here, or add photos below."
  ></textarea>
  <p class="hint">{text.length.toLocaleString('en-US')} / {TEXT_MAX.toLocaleString('en-US')} characters</p>

  <p class="field-label">Or add up to {PHOTO_MAX} photos (PNG, JPEG or WebP)</p>
  <DropZone
    accept={imageAccept}
    multiple={true}
    label="Drop photos or click to browse"
    bind:files={photos}
    bind:error={dropError}
    on:files={onPhotos}
  />
  <p class="hint">
    Photos are downscaled in your browser to at most 1 megapixel each (1.8 megapixels across all
    photos) and sent as JPEG, which also strips location data. Use one photo per page.
  </p>
  {#if photos.length > 0}
    <button class="btn-secondary" type="button" on:click={() => { photos = []; clearResult(); }}>Clear photos</button>
  {/if}
  {#if tooManyPhotos}<p class="warn" role="alert">Use at most {PHOTO_MAX} photos.</p>{/if}
  {#if text.length > TEXT_MAX}<p class="warn" role="alert">The text is over {TEXT_MAX.toLocaleString('en-US')} characters. Paste just the receipt or invoice.</p>{/if}
  {#if both}<p class="warn" role="alert">Use either pasted text or photos in one run. Clear one of them to continue.</p>{/if}

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? `Run ${tool.name} again` : `Run ${tool.name}`}
    </button>
  {:else}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert">
      <span class="panel-label error-label">Error</span>
      <p class="error-msg">{errorMsg}</p>
      <button class="btn-secondary" on:click={clearResult} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && result}
    <div class="result-panel">
      <div class="panel-header">
        <span class="panel-label">Extracted fields</span>
        <div class="result-actions">
          <button class="btn-secondary" on:click={copyJson} type="button">{copied ? 'Copied' : 'Copy JSON'}</button>
          <button class="btn-secondary" on:click={() => resultBlob && save(resultBlob, 'json')} type="button">Download JSON</button>
          <button class="btn-secondary" on:click={() => result && save(new Blob([receiptCsv(result)], { type: 'text/csv' }), 'csv')} type="button">Download CSV</button>
        </div>
      </div>

      {#if !result.hasConfidence}
        <p class="notice" role="note">
          The primary model was unavailable, so a backup model read this. It gives no confidence
          scores and lists at most 40 line items, so check every value.
        </p>
      {/if}
      {#if result.truncated}
        <p class="notice" role="note">
          The model could not read all of the input. Fields near the end may be missing.
        </p>
      {/if}
      <p class="notice" role="note">
        Check totals and tax against the original before you rely on them, especially on long item
        lists.
      </p>

      <div class="table-scroll">
        <table>
          <thead>
            <tr><th scope="col">Field</th><th scope="col">Value</th>{#if result.hasConfidence}<th scope="col">Confidence</th>{/if}</tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr class:missing={row.missing}>
                <th scope="row">{row.label}</th>
                <td class="value">{row.missing ? 'Missing' : row.value}</td>
                {#if result.hasConfidence}
                  <td class:low={row.low}>{row.confidence}{row.low ? ' (low)' : ''}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if resultBlob}
        <ChainSection {resultBlob} sourceToolId={tool.id} resultName={buildDownloadName(photos[0]?.name, tool.id, 'json')} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-3); }
  .field-label { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); }
  .hint { font-size: var(--text-xs); color: var(--text-subtle); line-height: 1.5; }
  .warn { font-size: var(--text-sm); color: var(--danger); }
  .receipt-text {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-3);
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    resize: vertical;
  }
  .receipt-text:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-primary {
    height: 32px; padding: 0 var(--space-3); background: var(--accent); color: var(--black);
    border: none; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--text-base);
    font-weight: 500; cursor: pointer; align-self: flex-start;
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible, .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }
  .btn-secondary {
    height: 32px; padding: 0 var(--space-3); background: transparent; color: var(--text-primary);
    border: 1px solid var(--border); border-radius: var(--radius-md); font-family: var(--font-mono);
    font-size: var(--text-sm); cursor: pointer; align-self: flex-start;
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }

  .result-panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .result-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .notice { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; border-left: 2px solid var(--accent-hover); padding-left: var(--space-2); }

  .table-scroll { max-width: 100%; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  th, td { text-align: left; vertical-align: top; padding: var(--space-2); border-bottom: 1px solid var(--border-subtle); }
  thead th { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-subtle); }
  tbody th { font-weight: 500; color: var(--text-primary); white-space: nowrap; }
  .value { white-space: pre-line; color: var(--text-primary); font-family: var(--font-mono); }
  tr.missing .value { color: var(--text-subtle); font-style: italic; }
  td.low { color: var(--danger); }
</style>
