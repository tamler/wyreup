<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { acquireWakeLock, releaseWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // Visual hash runner: each algorithm gets a labeled row with the
  // monospaced digest and a one-click copy button. JSON stays one
  // click away in a <details> drawer for scripted users.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface HashFileResult {
    name: string;
    bytes: number;
    hashes: Record<string, string>;
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlob: Blob | null = null;
  let results: HashFileResult[] = [];
  let copiedKey: string | null = null;

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }
  $: canRun = files.length >= tool.input.min && state !== 'running';

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    results = [];
    resultBlob = null;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    results = [];
    resultBlob = null;

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const blobs = await toolModule.run(files, params, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const list = Array.isArray(blobs) ? blobs : [blobs];
      const blob = list[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      const text = await blob.text();
      const parsed = JSON.parse(text);
      results = Array.isArray(parsed) ? (parsed as HashFileResult[]) : [parsed as HashFileResult];
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
    state = 'idle';
    errorMsg = '';
    results = [];
    resultBlob = null;
  }

  async function copyOne(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copiedKey = key;
      setTimeout(() => { if (copiedKey === key) copiedKey = null; }, 1200);
    } catch { /* ignore */ }
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(files[0]?.name, tool.id, 'json');
    a.click();
  }

  function algoLabel(algo: string): string {
    return algo.toUpperCase();
  }
</script>

<div class="runner">
  <DropZone
    accept={tool.input.accept}
    multiple={false}
    bind:files
    bind:error={dropError}
    on:files={onFiles}
  />

  <ParamsForm
    defaults={tool.defaults}
    paramSchema={tool.paramSchema}
    bind:params
    on:change={(e) => { params = e.detail; }}
  />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? 'Hash again' : 'Hash file'}
    </button>
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

  {#if state === 'done' && results.length > 0}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        {#each results as r}
          <div class="file-block">
            <div class="file-block__header">
              <div class="file-meta">
                <span class="file-meta__name">{r.name}</span>
                <span class="file-meta__size">{fmtBytes(r.bytes)}</span>
              </div>
              <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
            </div>

            <div class="hash-list">
              {#each Object.entries(r.hashes) as [algo, digest]}
                {@const key = `${r.name}:${algo}`}
                <div class="hash-row">
                  <span class="hash-row__algo">{algoLabel(algo)}</span>
                  <code class="hash-row__digest" title={digest}>{digest}</code>
                  <button
                    class="hash-row__copy"
                    on:click={() => copyOne(key, digest)}
                    type="button"
                    aria-label={`Copy ${algo}`}
                  >{copiedKey === key ? 'Copied' : 'Copy'}</button>
                </div>
              {/each}
            </div>
          </div>
        {/each}

        <details class="json-drawer">
          <summary>Show raw JSON</summary>
          <pre class="json-view">{JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}</pre>
        </details>

        {#if resultBlob}
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(files[0]?.name, tool.id, 'json')}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

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
    transition: background var(--duration-instant) var(--ease-sharp);
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .btn-secondary {
    height: 28px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }

  .file-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .file-block__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .file-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .file-meta__name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-meta__size { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }

  .hash-list { display: flex; flex-direction: column; gap: var(--space-1); }

  .hash-row {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .hash-row__algo {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    font-weight: 500;
  }

  .hash-row__digest {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .hash-row__copy {
    height: 24px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }
  .hash-row__copy:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .json-drawer summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    list-style: none;
    padding: var(--space-1) 0;
  }
  .json-drawer summary:hover { color: var(--text-muted); }
  .json-drawer summary::-webkit-details-marker { display: none; }

  .json-view {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow: auto;
    max-height: 280px;
    white-space: pre-wrap;
    margin: var(--space-2) 0 0;
    line-height: 1.5;
  }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent); border-left: 1px solid var(--accent); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-left: 1px solid var(--accent); }
</style>
