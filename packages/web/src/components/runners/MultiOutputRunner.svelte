<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlobs: Blob[] = [];
  let resultUrls: string[] = [];

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }

  $: canRun = files.length >= tool.input.min && state !== 'running';

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    clearResults();
  }

  function clearResults() {
    resultUrls.forEach((u) => URL.revokeObjectURL(u));
    resultBlobs = [];
    resultUrls = [];
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    clearResults();

    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run(files, params, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      resultBlobs = Array.isArray(result) ? result : [result];
      resultUrls = resultBlobs.map((b) => URL.createObjectURL(b));
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function reset() {
    state = 'idle';
    errorMsg = '';
    clearResults();
  }

  function downloadOne(index: number) {
    const url = resultUrls[index];
    const blob = resultBlobs[index];
    if (!url || !blob) return;
    const a = document.createElement('a');
    a.href = url;
    const ext = blob.type.split('/')[1] ?? 'bin';
    const base = buildDownloadName(files[0]?.name, tool.id, ext);
    // Insert "-N" before the extension: "photo-split-pdf.pdf" → "photo-split-pdf-1.pdf".
    a.download = base.replace(/(\.[^.]+)$/, `-${index + 1}$1`);
    a.click();
  }

  async function downloadAll() {
    for (let i = 0; i < resultBlobs.length; i++) {
      downloadOne(i);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
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

  <ParamsForm defaults={tool.defaults} paramSchema={tool.paramSchema} bind:params on:change={(e) => { params = e.detail; }} />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? `Run ${tool.name} again` : `Run ${tool.name}`}
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

  {#if state === 'done' && resultBlobs.length > 0}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
          <span class="result-count">{resultBlobs.length} file{resultBlobs.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="panel-divider"></div>

        <div class="output-list">
          {#each resultBlobs as blob, i}
            <div class="output-row">
              {#if resultUrls[i] && blob.type.startsWith('image/')}
                <img class="output-thumb" src={resultUrls[i]} alt="Output {i + 1}" />
              {/if}
              <div class="output-meta">
                <span class="output-name">{tool.id}-{i + 1}.{blob.type.split('/')[1] ?? 'bin'}</span>
                <span class="output-size">{formatBytes(blob.size)}</span>
              </div>
              <button class="btn-secondary output-dl" on:click={() => downloadOne(i)} type="button">
                Download
              </button>
            </div>
          {/each}
        </div>

        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-primary" on:click={downloadAll} type="button">Download all</button>
        </div>

        {#if resultBlobs.length > 0}
          <ChainSection
            resultBlob={resultBlobs[0]}
            resultName={buildDownloadName(files[0]?.name, tool.id, resultBlobs[0]?.type.split('/')[1] ?? 'bin')}
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
    transition: background var(--duration-instant) var(--ease-sharp), transform var(--duration-instant) var(--ease-sharp);
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    align-self: flex-start;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .result-count { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; overflow: visible; }

  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }

  .output-list { display: flex; flex-direction: column; gap: var(--space-2); }

  .output-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); }

  .output-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }

  .output-meta { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }

  .output-name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .output-size { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }

  .output-dl { align-self: center; }

  .result-actions { display: flex; gap: var(--space-2); }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent); border-left: 1px solid var(--accent); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-left: 1px solid var(--accent); }
</style>
