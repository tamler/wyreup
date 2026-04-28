<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // pdf-info renders as a stat grid (page count + size) plus a
  // metadata table (title / author / subject / creator / producer /
  // dates) — null fields render as a quiet "—" so missing metadata
  // is obvious without dropping rows.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface Result {
    pageCount: number;
    bytes: number;
    title: string | null;
    author: string | null;
    subject: string | null;
    producer: string | null;
    creator: string | null;
    createdAt: string | null;
    modifiedAt: string | null;
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: Result | null = null;
  let resultBlob: Blob | null = null;

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= 1 && state !== 'running';

  function fmtBytes(n: number): string {
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function fmtDate(s: string | null): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString();
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    result = null;
    resultBlob = null;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error('Tool not found.');
      const blobs = await toolModule.run(files, {}, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) throw new Error('No output.');
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as Result;
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(files[0]?.name, tool.id, 'json');
    a.click();
  }

  $: metaRows = result
    ? [
        ['Title', result.title],
        ['Author', result.author],
        ['Subject', result.subject],
        ['Creator', result.creator],
        ['Producer', result.producer],
        ['Created', fmtDate(result.createdAt)],
        ['Modified', fmtDate(result.modifiedAt)],
      ] as const
    : [];
</script>

<div class="runner">
  <DropZone accept={tool.input.accept} multiple={false} bind:files bind:error={dropError} on:files={onFiles} />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? 'Inspect again' : 'Inspect PDF'}
    </button>
  {/if}

  {#if state === 'running'}<ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />{/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert"><p class="error-msg">{errorMsg}</p></div>
  {/if}

  {#if state === 'done' && result}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="stat-grid">
          <div class="stat stat--big"><dt>Pages</dt><dd>{result.pageCount.toLocaleString()}</dd></div>
          <div class="stat stat--big"><dt>Size</dt><dd>{fmtBytes(result.bytes)}</dd></div>
        </div>

        <div class="meta-table">
          <div class="meta-table__header">
            <span>Document metadata</span>
            <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
          </div>
          {#each metaRows as [label, val]}
            <div class="meta-row">
              <span class="meta-row__label">{label}</span>
              <span class="meta-row__value" class:meta-row__value--empty={val == null || val === '—'}>{val ?? '—'}</span>
            </div>
          {/each}
        </div>

        <details class="json-drawer">
          <summary>Show raw JSON</summary>
          <pre class="json-view">{JSON.stringify(result, null, 2)}</pre>
        </details>

        {#if resultBlob}
          <ChainSection resultBlob={resultBlob} sourceToolId={tool.id} resultName={buildDownloadName(files[0]?.name, tool.id, 'json')} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }
  .btn-primary { height: 32px; padding: 0 var(--space-3); background: var(--accent); color: var(--black); border: none; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--text-base); font-weight: 500; cursor: pointer; align-self: flex-start; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-secondary { height: 28px; padding: 0 var(--space-3); background: transparent; color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); cursor: pointer; }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-3) var(--space-4); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--danger); margin: 0; }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-2); margin: 0; }
  .stat { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
  .stat dt { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .stat dd { font-family: var(--font-mono); margin: 0; color: var(--text-primary); }
  .stat--big dd { font-size: var(--text-2xl); font-weight: 600; letter-spacing: -0.01em; }

  .meta-table { display: flex; flex-direction: column; gap: 1px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); overflow: hidden; }
  .meta-table__header { display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) var(--space-3); background: var(--bg-elevated); font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .meta-row { display: grid; grid-template-columns: 130px 1fr; gap: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--bg); }
  .meta-row__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }
  .meta-row__value { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta-row__value--empty { color: var(--text-subtle); font-style: italic; }

  .json-drawer summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.08em; list-style: none; padding: var(--space-1) 0; }
  .json-drawer summary:hover { color: var(--text-muted); }
  .json-drawer summary::-webkit-details-marker { display: none; }
  .json-view { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-primary); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: var(--space-3); overflow: auto; max-height: 280px; white-space: pre-wrap; margin: var(--space-2) 0 0; }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent); border-left: 1px solid var(--accent); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
</style>
