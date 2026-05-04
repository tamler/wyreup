<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // image-similarity: thumbnails grid + pairwise score bars. Cosine
  // similarity is in [0..1]; the bar fills accordingly and the row is
  // tinted when the pair is a near-duplicate (>= threshold).

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface Result {
    images: Array<{ filename: string; index: number }>;
    pairwise: Array<{ a: number; b: number; cosine: number }>;
    clusters?: number[][];
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: Result | null = null;
  let resultBlob: Blob | null = null;
  let thumbUrls: string[] = [];

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= tool.input.min && state !== 'running';
  $: threshold = typeof params.threshold === 'number' ? params.threshold : 0.85;

  $: {
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls = files.map((f) => URL.createObjectURL(f));
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    result = null;
    resultBlob = null;
  }

  function handleAdditionalFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (tool.input.accept.length && !tool.input.accept.includes('*/*')) {
      input.accept = tool.input.accept.join(',');
    }
    input.onchange = () => {
      const newFiles = Array.from(input.files ?? []);
      if (newFiles.length > 0) {
        const max = tool.input.max ?? Infinity;
        files = [...files, ...newFiles].slice(0, max);
        state = 'idle';
        result = null;
        resultBlob = null;
      }
    };
    input.click();
  }

  function removeFile(i: number) {
    files = files.filter((_, idx) => idx !== i);
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
      const blobs = await toolModule.run(files, params, {
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

  function scoreClass(cosine: number): string {
    if (cosine >= threshold) return 'score--match';
    if (cosine >= 0.7) return 'score--warm';
    return 'score--cold';
  }

  $: sortedPairs = result
    ? [...result.pairwise].sort((x, y) => y.cosine - x.cosine)
    : [];
  $: realClusters = result?.clusters?.filter((c) => c.length > 1) ?? [];
</script>

<div class="runner">
  {#if files.length === 0}
    <DropZone accept={tool.input.accept} multiple={true} bind:files bind:error={dropError} on:files={onFiles} label="Drop 2+ images to compare" />
  {:else}
    <div class="file-list">
      <div class="file-list__header">
        <span class="file-list__label">{files.length} image{files.length !== 1 ? 's' : ''}</span>
        <button class="btn-ghost" on:click={handleAdditionalFiles} type="button">Add more</button>
      </div>
      <div class="thumb-strip">
        {#each files as f, i}
          <div class="thumb-card">
            <img src={thumbUrls[i]} alt={f.name} class="thumb-card__img" />
            <span class="thumb-card__index">{i}</span>
            <button class="thumb-card__remove" on:click={() => removeFile(i)} type="button" aria-label="Remove {f.name}">×</button>
            <span class="thumb-card__name">{f.name}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <ParamsForm defaults={tool.defaults} paramSchema={tool.paramSchema} bind:params on:change={(e) => { params = e.detail; }} />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? 'Compare again' : 'Compare images'}
    </button>
  {/if}

  {#if state === 'running'}<ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />{/if}
  {#if state === 'error'}<div class="error-panel" role="alert"><p class="error-msg">{errorMsg}</p></div>{/if}

  {#if state === 'done' && result}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="result-header">
          <span class="panel-label">Pairwise similarity</span>
          <span class="panel-sub">Threshold {threshold.toFixed(2)} · {realClusters.length} cluster{realClusters.length !== 1 ? 's' : ''}</span>
          <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
        </div>

        <div class="pair-list">
          {#each sortedPairs as p}
            <div class="pair-row {scoreClass(p.cosine)}">
              <div class="pair-row__pair">
                <img src={thumbUrls[p.a]} alt={result.images[p.a]?.filename ?? ''} class="pair-thumb" />
                <span class="pair-vs">↔</span>
                <img src={thumbUrls[p.b]} alt={result.images[p.b]?.filename ?? ''} class="pair-thumb" />
              </div>
              <div class="pair-row__bar" aria-hidden="true">
                <div class="pair-row__bar-fill" style="width: {Math.max(0, p.cosine * 100).toFixed(1)}%"></div>
              </div>
              <span class="pair-row__score">{p.cosine.toFixed(3)}</span>
            </div>
          {/each}
        </div>

        {#if realClusters.length > 0}
          <div class="clusters">
            <span class="panel-label">Clusters (≥ {threshold.toFixed(2)})</span>
            {#each realClusters as cluster, ci}
              <div class="cluster">
                <span class="cluster__label">Cluster {ci + 1}</span>
                <div class="cluster__thumbs">
                  {#each cluster as idx}
                    <img src={thumbUrls[idx]} alt={result.images[idx]?.filename ?? ''} class="cluster__thumb" title={result.images[idx]?.filename ?? ''} />
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

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
  .btn-ghost { background: none; border: none; color: var(--text-subtle); font-family: var(--font-mono); font-size: var(--text-sm); cursor: pointer; padding: 0; }
  .btn-ghost:hover { color: var(--text-muted); }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-3) var(--space-4); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--danger); margin: 0; }

  .file-list { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); overflow: hidden; }
  .file-list__header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-3); background: var(--bg-raised); border-bottom: 1px solid var(--border); }
  .file-list__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.08em; }

  .thumb-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-2); padding: var(--space-3); }
  .thumb-card { position: relative; display: flex; flex-direction: column; gap: var(--space-1); }
  .thumb-card__img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); background: var(--bg); }
  .thumb-card__index { position: absolute; top: var(--space-1); left: var(--space-1); font-family: var(--font-mono); font-size: var(--text-xs); padding: 2px 6px; background: rgba(0, 0, 0, 0.7); color: white; border-radius: var(--radius-sm); }
  .thumb-card__remove { position: absolute; top: var(--space-1); right: var(--space-1); width: 22px; height: 22px; padding: 0; border-radius: 50%; border: none; background: rgba(0, 0, 0, 0.7); color: white; cursor: pointer; line-height: 1; font-size: 16px; }
  .thumb-card__remove:hover { background: var(--danger); }
  .thumb-card__name { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }

  .result-header { display: grid; grid-template-columns: auto 1fr auto; gap: var(--space-3); align-items: center; }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .panel-sub { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }

  .pair-list { display: flex; flex-direction: column; gap: var(--space-2); }
  .pair-row { display: grid; grid-template-columns: auto 1fr 60px; gap: var(--space-3); align-items: center; padding: var(--space-2) var(--space-3); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
  .pair-row.score--match { border-color: var(--accent); background: var(--accent-dim, var(--bg)); }

  .pair-row__pair { display: flex; align-items: center; gap: var(--space-1); }
  .pair-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); }
  .pair-vs { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-subtle); }

  .pair-row__bar { position: relative; height: 6px; background: var(--bg-elevated); border-radius: 3px; overflow: hidden; }
  .pair-row__bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--text-muted); }
  .pair-row.score--match .pair-row__bar-fill { background: var(--accent); }
  .pair-row.score--warm .pair-row__bar-fill { background: var(--text-primary); }
  .pair-row.score--cold .pair-row__bar-fill { background: var(--text-subtle); }

  .pair-row__score { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); text-align: right; }
  .pair-row.score--match .pair-row__score { color: var(--accent-text); font-weight: 600; }

  .clusters { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
  .cluster { display: flex; flex-direction: column; gap: var(--space-1); }
  .cluster__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
  .cluster__thumbs { display: flex; gap: var(--space-1); flex-wrap: wrap; }
  .cluster__thumb { width: 48px; height: 48px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--accent-hover); }

  .json-drawer summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.08em; list-style: none; padding: var(--space-1) 0; }
  .json-drawer summary:hover { color: var(--text-muted); }
  .json-drawer summary::-webkit-details-marker { display: none; }
  .json-view { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-primary); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: var(--space-3); overflow: auto; max-height: 280px; white-space: pre-wrap; margin: var(--space-2) 0 0; }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
</style>
