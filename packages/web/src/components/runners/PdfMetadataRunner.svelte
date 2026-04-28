<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // pdf-metadata is multi-mode: read returns JSON, write/strip return
  // a PDF blob. Render the metadata visually for read mode; offer the
  // PDF download for the others.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface ReadResult {
    title: string | null;
    author: string | null;
    subject: string | null;
    keywords: string[];
    creator: string | null;
    producer: string | null;
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlob: Blob | null = null;
  let readResult: ReadResult | null = null;
  let outputMime = '';
  let copied: string | null = null;

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= 1 && state !== 'running';
  $: isRead = outputMime === 'application/json';

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    readResult = null;
    resultBlob = null;
    outputMime = '';
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
      const blobs = await toolModule.run(files, params, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) throw new Error('No output.');
      resultBlob = blob;
      outputMime = blob.type;
      if (blob.type === 'application/json') {
        readResult = JSON.parse(await blob.text()) as ReadResult;
      } else {
        readResult = null;
      }
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = label;
      setTimeout(() => { if (copied === label) copied = null; }, 1200);
    } catch { /* ignore */ }
  }

  function download() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    const ext = isRead ? 'json' : 'pdf';
    a.download = buildDownloadName(files[0]?.name, tool.id, ext);
    a.click();
  }

  $: rows = readResult
    ? ([
        ['Title', readResult.title],
        ['Author', readResult.author],
        ['Subject', readResult.subject],
        ['Creator', readResult.creator],
        ['Producer', readResult.producer],
      ] as const)
    : [];
</script>

<div class="runner">
  <DropZone accept={tool.input.accept} multiple={false} bind:files bind:error={dropError} on:files={onFiles} />
  <ParamsForm defaults={tool.defaults} paramSchema={tool.paramSchema} bind:params on:change={(e) => { params = e.detail; }} />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">Run</button>
  {/if}
  {#if state === 'running'}<ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />{/if}
  {#if state === 'error'}<div class="error-panel" role="alert"><p class="error-msg">{errorMsg}</p></div>{/if}

  {#if state === 'done' && resultBlob}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        {#if isRead && readResult}
          <div class="meta-table">
            <div class="meta-table__header">
              <span>Document metadata</span>
              <button class="btn-secondary" on:click={download} type="button">Download JSON</button>
            </div>
            {#each rows as [label, val]}
              <div class="meta-row">
                <span class="meta-row__label">{label}</span>
                <span class="meta-row__value" class:meta-row__value--empty={!val}>{val ?? '—'}</span>
                {#if val}
                  <button class="meta-row__copy" on:click={() => copy(label, val)} type="button">
                    {copied === label ? '✓' : 'Copy'}
                  </button>
                {/if}
              </div>
            {/each}
            <div class="meta-row">
              <span class="meta-row__label">Keywords</span>
              <div class="keywords">
                {#if readResult.keywords.length === 0}
                  <span class="meta-row__value meta-row__value--empty">—</span>
                {:else}
                  {#each readResult.keywords as kw}
                    <span class="kw-chip">{kw}</span>
                  {/each}
                {/if}
              </div>
            </div>
          </div>

          <details class="json-drawer">
            <summary>Show raw JSON</summary>
            <pre class="json-view">{JSON.stringify(readResult, null, 2)}</pre>
          </details>
        {:else}
          <div class="result-actions">
            <span class="panel-label">Modified PDF</span>
            <button class="btn-secondary" on:click={download} type="button">Download PDF</button>
          </div>
        {/if}

        <ChainSection resultBlob={resultBlob} sourceToolId={tool.id} resultName={buildDownloadName(files[0]?.name, tool.id, isRead ? 'json' : 'pdf')} />
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
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }

  .meta-table { display: flex; flex-direction: column; gap: 1px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); overflow: hidden; }
  .meta-table__header { display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) var(--space-3); background: var(--bg-elevated); font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .meta-row { display: grid; grid-template-columns: 130px 1fr auto; gap: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--bg); align-items: center; }
  .meta-row__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }
  .meta-row__value { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta-row__value--empty { color: var(--text-subtle); font-style: italic; }
  .meta-row__copy { height: 22px; padding: 0 var(--space-2); background: var(--bg-raised); color: var(--text-muted); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); cursor: pointer; }
  .meta-row__copy:hover { color: var(--text-primary); }

  .keywords { display: flex; flex-wrap: wrap; gap: var(--space-1); grid-column: 2 / span 2; }
  .kw-chip { font-family: var(--font-mono); font-size: var(--text-xs); padding: 2px 8px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); color: var(--text-muted); }

  .result-actions { display: flex; align-items: center; justify-content: space-between; padding: var(--space-3); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }

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
