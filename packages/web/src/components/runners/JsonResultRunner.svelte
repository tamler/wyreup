<script lang="ts">
  import { onDestroy } from 'svelte';
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  import { buildDownloadName } from './naming';
  import { holdWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import { tryReserveMediaJob } from '../../lib/mediaJobReservation';
  import type { SerializedTool, PreloadAdmission } from './types';
  import { hasBrowserFileImport } from '../../lib/file-tool-candidates';
  import type { ToolProgress } from '@wyreup/core';

  const wakeOwners = new Set<ReturnType<typeof holdWakeLock>>();

  function releaseOwnedWakeLocks() {
    for (const owner of wakeOwners) owner.release();
    wakeOwners.clear();
  }

  let generation = 0;
  let disposed = false;
  const downloadUrls = new Set<string>();
  const downloadTimers = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => { disposed = true; generation++; releaseOwnedWakeLocks(); for (const url of downloadUrls) URL.revokeObjectURL(url); for (const timer of downloadTimers) clearTimeout(timer); });

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;

  // For JSON tools that may not require file input
  const requiresFile = tool.input.min > 0;

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultJson = '';
  let resultBlob: Blob | null = null;

  // Upgrade seam: the heuristic from-text tools emit confidence: 'no-match'
  // when the input is beyond their pattern library. Turn that dead-end
  // into a one-click path to the hosted-AI Pro fallback.
  const PRO_FALLBACK: Record<string, string> = {
    'regex-from-text': 'regex-from-text-pro',
    'cron-from-text': 'cron-from-text-pro',
  };
  $: upgradeTool = (() => {
    const fallback = PRO_FALLBACK[tool.id];
    if (!fallback || !resultJson) return null;
    try {
      const parsed = JSON.parse(resultJson) as { confidence?: string };
      return parsed.confidence === 'no-match' ? fallback : null;
    } catch {
      return null;
    }
  })();

  let priorPreload = preloadedFile;
  $: if (preloadedFile !== priorPreload) { priorPreload = preloadedFile; reset(); files = preloadedFile ? [preloadedFile] : []; }

  $: canRun = (requiresFile ? files.length >= tool.input.min : true) && state !== 'running';

  function onFiles(e: CustomEvent<File[]>) {
    generation++;
    files = e.detail;
    dropError = '';
    state = 'idle';
    resultJson = '';
    resultBlob = null;
  }

  async function run() {
    if (!canRun) return;
    const lease = tryReserveMediaJob([tool.id]);
    if (!lease) {
      state = 'error';
      errorMsg = 'Another media job is still running. Your input is retained. Retry after it settles; if it never settles, reload manually.';
      return;
    }
    const attempt = ++generation;
    const capturedFiles = [...files];
    const capturedParams = { ...params };
    const capturedToolId = tool.id;
    const imported = preloadedFile;
    const admission = onPreloadAdmission;
    const current = () => !disposed && attempt === generation && tool.id === capturedToolId && preloadedFile === imported && capturedFiles.length === files.length && capturedFiles.every((file, index) => file === files[index]) && JSON.stringify(params) === JSON.stringify(capturedParams);
    state = 'running';
    errorMsg = '';
    resultJson = '';

    const wake = holdWakeLock();
    wakeOwners.add(wake);
    try {
      const { createDefaultRegistry } = await import('../../lib/core-execution');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run(capturedFiles, capturedParams, {
        onProgress: (p) => { if (current()) progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      const text = await blob.text();
      if (!current()) return;
      resultBlob = blob;
      try {
        resultJson = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        resultJson = text;
      }
      markToolUsed(tool.id);
      state = 'done';
      if (imported && capturedFiles.includes(imported) && hasBrowserFileImport(tool) && tool.input.max !== 0) admission?.({ file: imported, status: 'admitted' });
    } catch (err) {
      if (!current()) return;
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
      if (imported && capturedFiles.includes(imported) && hasBrowserFileImport(tool) && tool.input.max !== 0) admission?.({ file: imported, status: 'refused', message: errorMsg });
    } finally {
      lease.release();
      wake.release();
      wakeOwners.delete(wake);
    }
  }

  function reset() {
    generation++;
    releaseOwnedWakeLocks();
    state = 'idle';
    errorMsg = '';
    resultJson = '';
    resultBlob = null;
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(resultJson);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch { /* ignore */ }
  }

  function download() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    const url = URL.createObjectURL(resultBlob);
    downloadUrls.add(url);
    a.href = url;
    a.download = buildDownloadName(files[0]?.name, tool.id, 'json');
    a.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); downloadTimers.delete(timer); }, 1000);
    downloadTimers.add(timer);
  }

  let copied = false;
</script>

<div class="runner">
  {#if requiresFile}
    <DropZone
      accept={tool.input.accept}
      sizeLimit={tool.input.sizeLimit}
      multiple={tool.input.max !== 1}
      bind:files
      bind:error={dropError}
      on:files={onFiles}
    />
  {/if}

  <ParamsForm defaults={tool.defaults} paramSchema={tool.paramSchema} bind:params on:change={(e) => { params = e.detail; reset(); }} />

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

  {#if state === 'done' && resultJson}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
          <div class="result-actions">
            <button class="btn-secondary" on:click={copyResult} type="button">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button class="btn-secondary" on:click={download} type="button">Download</button>
          </div>
        </div>
        <div class="panel-divider"></div>
        <FlatJsonResult json={resultJson} />

        {#if upgradeTool}
          <a class="upgrade-seam" href={`/tools/${upgradeTool}`}>
            <span class="upgrade-seam__chip">PRO</span>
            <span class="upgrade-seam__text">
              The free engine didn't recognize this. Generate it with hosted AI — 1 credit.
            </span>
            <span class="upgrade-seam__arrow" aria-hidden="true">&rarr;</span>
          </a>
        {/if}

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
    transition: background var(--duration-instant) var(--ease-sharp), transform var(--duration-instant) var(--ease-sharp);
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; overflow: visible; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }

  .result-actions { display: flex; gap: var(--space-2); }

  .upgrade-seam {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--accent-dim);
    border: 1px solid var(--accent-hover);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: background var(--duration-instant) var(--ease-sharp);
  }
  .upgrade-seam:hover {
    background: var(--bg-raised);
  }
  .upgrade-seam__chip {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    background: var(--accent);
    color: var(--black);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .upgrade-seam__text {
    flex: 1;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-primary);
    line-height: 1.45;
  }
  .upgrade-seam__arrow {
    font-family: var(--font-mono);
    color: var(--accent-text);
    flex-shrink: 0;
  }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
</style>
