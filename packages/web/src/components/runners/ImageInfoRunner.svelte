<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // image-info renders as a thumbnail-led card: dimensions / format /
  // megapixels / size / aspect ratio in a grid. JSON one click away.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface Result {
    format: string;
    mimeType: string;
    width: number;
    height: number;
    aspectRatio: string;
    bytes: number;
    megapixels: number;
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: Result | null = null;
  let resultBlob: Blob | null = null;
  let thumbUrl: string | null = null;

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= 1 && state !== 'running';

  $: {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = files[0] ? URL.createObjectURL(files[0]) : null;
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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
</script>

<div class="runner">
  <DropZone accept={tool.input.accept} multiple={false} bind:files bind:error={dropError} on:files={onFiles} />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? 'Inspect again' : 'Inspect image'}
    </button>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert"><p class="error-msg">{errorMsg}</p></div>
  {/if}

  {#if state === 'done' && result}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="header-row">
          {#if thumbUrl}
            <img src={thumbUrl} alt={files[0]?.name ?? 'image'} class="thumb" />
          {/if}
          <div class="header-meta">
            <span class="header-meta__name">{files[0]?.name ?? 'image'}</span>
            <span class="header-meta__sub">{result.format.toUpperCase()} · {fmtBytes(result.bytes)}</span>
          </div>
          <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
        </div>

        <div class="stat-grid">
          <div class="stat"><dt>Dimensions</dt><dd>{result.width.toLocaleString()} × {result.height.toLocaleString()} px</dd></div>
          <div class="stat"><dt>Aspect ratio</dt><dd>{result.aspectRatio}</dd></div>
          <div class="stat"><dt>Megapixels</dt><dd>{result.megapixels.toFixed(2)} MP</dd></div>
          <div class="stat"><dt>Format</dt><dd>{result.format}</dd></div>
          <div class="stat"><dt>MIME</dt><dd><code>{result.mimeType}</code></dd></div>
          <div class="stat"><dt>Size</dt><dd>{fmtBytes(result.bytes)}</dd></div>
        </div>

        <details class="json-drawer">
          <summary>Show raw JSON</summary>
          <pre class="json-view">{JSON.stringify(result, null, 2)}</pre>
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

  .btn-primary { height: 32px; padding: 0 var(--space-3); background: var(--accent); color: var(--black); border: none; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--text-base); font-weight: 500; cursor: pointer; align-self: flex-start; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }

  .btn-secondary { height: 28px; padding: 0 var(--space-3); background: transparent; color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); cursor: pointer; }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-3) var(--space-4); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--danger); margin: 0; }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }

  .header-row { display: grid; grid-template-columns: auto 1fr auto; gap: var(--space-3); align-items: center; }
  .thumb { width: 80px; height: 80px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); background: var(--bg); }
  .header-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .header-meta__name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header-meta__sub { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-2); margin: 0; }
  .stat { display: flex; flex-direction: column; gap: 2px; padding: var(--space-3); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
  .stat dt { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .stat dd { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); margin: 0; }
  .stat code { font-family: var(--font-mono); }

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
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-left: 1px solid var(--accent); }
</style>
