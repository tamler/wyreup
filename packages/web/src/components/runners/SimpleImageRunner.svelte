<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { acquireWakeLock, releaseWakeLock } from '../../lib/wakeLock';
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

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;
  let resultSize = 0;
  let resultDimensions = '';
  let originalSize = 0;

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }

  $: canRun = files.length >= tool.input.min && state !== 'running';

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    resultBlob = null;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    originalSize = files[0]?.size ?? 0;

    const ac = new AbortController();
    const cache = new Map<string, unknown>();

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run(files, params, {
        onProgress: (p) => { progress = p; },
        signal: ac.signal,
        cache,
        executionId: crypto.randomUUID(),
      });

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      resultSize = blob.size;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);

      // Get dimensions
      if (blob.type.startsWith('image/')) {
        const img = new Image();
        img.src = resultUrl;
        await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); });
        resultDimensions = `${img.naturalWidth}×${img.naturalHeight}px`;
      }

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
    resultBlob = null;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
  }

  function download() {
    if (!resultUrl || !resultBlob) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    const ext = resultBlob.type.split('/')[1] ?? 'bin';
    a.download = buildDownloadName(files[0]?.name, tool.id, ext);
    a.click();
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  function reductionPct(before: number, after: number): string {
    if (before === 0) return '—';
    const pct = ((before - after) / before) * 100;
    return `${pct > 0 ? '-' : '+'}${Math.abs(pct).toFixed(1)}%`;
  }
</script>

<div class="runner">
  {#if tool.requiresWebgpu === 'required'}
    <div class="capability-banner capability-banner--required" role="alert">
      <span class="cap-label">WebGPU required</span>
      <span class="cap-msg">Your browser does not support WebGPU. Use the CLI: <code>npx @wyreup/cli {tool.id} &lt;file&gt;</code></span>
    </div>
  {:else if tool.requiresWebgpu === 'preferred'}
    <div class="capability-banner capability-banner--preferred" role="status">
      <span class="cap-label">Slower mode</span>
      <span class="cap-msg">Your browser lacks WebGPU — running in compatibility mode.</span>
    </div>
  {/if}

  <DropZone
    accept={tool.input.accept}
    multiple={false}
    bind:files
    bind:error={dropError}
    on:files={onFiles}
    label="Drop an image or click to browse"
  />

  <ParamsForm
    defaults={tool.defaults}
    paramSchema={tool.paramSchema}
    bind:params
    on:change={(e) => { params = e.detail; }}
  />

  {#if state === 'idle' || state === 'done' || state === 'error'}
    <button
      class="btn-primary"
      on:click={run}
      disabled={!canRun}
      type="button"
    >
      {state === 'done' ? `Run ${tool.name} again` : `Run ${tool.name}`}
    </button>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert">
      <div class="panel-header">
        <span class="panel-label error-label">Error</span>
      </div>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" on:click={reset} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && resultBlob && resultUrl}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
        </div>
        <div class="panel-divider"></div>

        <img class="result-img" src={resultUrl} alt="Result" />

        <div class="panel-divider"></div>

        <div class="solder-row">
          <span class="solder-key">Original</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{formatBytes(originalSize)}</span>
        </div>
        <div class="solder-row">
          <span class="solder-key">Output</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{formatBytes(resultSize)}</span>
        </div>
        {#if originalSize > 0}
          <div class="solder-row solder-row--accent">
            <span class="solder-key">Change</span>
            <span class="solder-rule" aria-hidden="true"></span>
            <span class="solder-pad solder-pad--accent" aria-hidden="true"></span>
            <span class="solder-val solder-val--accent">{reductionPct(originalSize, resultSize)}</span>
          </div>
        {/if}
        {#if resultDimensions}
          <div class="solder-row">
            <span class="solder-key">Dimensions</span>
            <span class="solder-rule" aria-hidden="true"></span>
            <span class="solder-pad" aria-hidden="true"></span>
            <span class="solder-val">{resultDimensions}</span>
          </div>
        {/if}

        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-primary" on:click={download} type="button">Download result</button>
        </div>

        <ChainSection
          resultBlob={resultBlob}
          resultName={buildDownloadName(files[0]?.name, tool.id, resultBlob?.type.split('/')[1] ?? 'bin')}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .runner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Capability banners */
  .capability-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .capability-banner--required {
    border-color: var(--danger);
    background: rgba(239, 68, 68, 0.08);
  }

  .capability-banner--preferred {
    border-color: var(--warning);
    background: rgba(234, 179, 8, 0.08);
  }

  .cap-label {
    font-weight: 500;
    color: var(--text-primary);
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
  }

  .cap-msg {
    color: var(--text-muted);
  }

  .cap-msg code {
    font-family: var(--font-mono);
    background: var(--bg-raised);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  /* Buttons */
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
    transition:
      background var(--duration-instant) var(--ease-sharp),
      transform var(--duration-instant) var(--ease-sharp);
    align-self: flex-start;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-primary:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-primary:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

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
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
    align-self: flex-start;
  }

  .btn-secondary:hover {
    background: var(--bg-raised);
    border-color: var(--text-muted);
  }

  .btn-secondary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Error panel */
  .error-panel {
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .error-label {
    color: var(--danger);
  }

  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .panel-divider {
    height: 1px;
    background: var(--border-subtle);
  }

  /* Result panel */
  .result-panel {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    overflow: visible;
  }

  .result-panel__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .result-img {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    background: var(--bg);
    align-self: flex-start;
  }

  /* Solder rows */
  .solder-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 20px;
  }

  .solder-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-weight: 400;
    min-width: 80px;
    flex-shrink: 0;
  }

  .solder-rule {
    flex: 1;
    height: 1px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .solder-pad {
    width: 3px;
    height: 3px;
    background: var(--border);
    flex-shrink: 0;
  }

  .solder-pad--accent {
    background: var(--accent);
  }

  .solder-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
    min-width: 80px;
    text-align: right;
  }

  .solder-val--accent {
    color: var(--accent);
  }

  .result-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  /* Corner bracket motif */
  .brackets::before,
  .brackets::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .brackets::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--accent);
    border-left: 1px solid var(--accent);
  }

  .brackets::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
  }

  .brackets-inner {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .brackets-inner::before,
  .brackets-inner::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .brackets-inner::before {
    top: -5px;
    right: -5px;
    border-top: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
  }

  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--accent);
    border-left: 1px solid var(--accent);
  }
</style>
