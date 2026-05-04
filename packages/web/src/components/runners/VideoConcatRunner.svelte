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

  // video-concat needs ordered inputs — it joins clips end-to-end and the
  // order is the result. The generic MultiInputRunner has add/remove but no
  // reorder. This runner adds thumbnails and up/down buttons so the user
  // can sequence the clips before joining.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface Clip {
    id: string;
    file: File;
    url: string;
    thumb: string | null;
    duration: number;
  }

  let clips: Clip[] = [];
  let dropError = '';
  let params: Record<string, unknown> = { ...tool.defaults };

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;
  let resultSize = 0;
  let totalInputSize = 0;
  let totalDuration = 0;

  $: canRun =
    clips.length >= tool.input.min &&
    clips.length <= tool.input.max &&
    state !== 'running';

  $: totalDuration = clips.reduce((sum, c) => sum + (c.duration || 0), 0);

  // Bridge an incoming preloaded file (chain hand-off) into the clip list
  // exactly once. Subsequent file additions go through the dropzone.
  $: if (preloadedFile && clips.length === 0) {
    void addFiles([preloadedFile]);
  }

  async function addFiles(incoming: File[]) {
    const max = tool.input.max ?? 20;
    const room = max - clips.length;
    if (room <= 0) return;
    const accepted = incoming
      .filter((f) => f.type.startsWith('video/'))
      .slice(0, room);

    const newClips: Clip[] = [];
    for (const file of accepted) {
      const url = URL.createObjectURL(file);
      const meta = await loadMeta(url);
      newClips.push({
        id: crypto.randomUUID(),
        file,
        url,
        thumb: meta.thumb,
        duration: meta.duration,
      });
    }
    clips = [...clips, ...newClips];
    dropError = '';
    state = 'idle';
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  async function loadMeta(url: string): Promise<{ thumb: string | null; duration: number }> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.src = url;

      let resolved = false;
      const finish = (thumb: string | null, duration: number) => {
        if (resolved) return;
        resolved = true;
        resolve({ thumb, duration: Number.isFinite(duration) ? duration : 0 });
      };

      const onSeeked = () => {
        try {
          const w = Math.min(v.videoWidth || 320, 320);
          const h = Math.round((v.videoHeight || 180) * (w / (v.videoWidth || 320)));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(v, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          finish(dataUrl, v.duration);
        } catch {
          finish(null, v.duration);
        }
      };

      v.addEventListener('loadedmetadata', () => {
        const t = Math.min(0.5, (v.duration || 1) * 0.1);
        try {
          v.currentTime = t;
        } catch {
          finish(null, v.duration);
        }
      });
      v.addEventListener('seeked', onSeeked);
      v.addEventListener('error', () => finish(null, 0));
      // Hard timeout: some files don't fire seeked reliably.
      setTimeout(() => finish(null, v.duration || 0), 6000);
    });
  }

  function onFiles(e: CustomEvent<File[]>) {
    void addFiles(e.detail);
  }

  function moveUp(i: number) {
    if (i <= 0) return;
    const next = clips.slice();
    const item = next[i];
    const prev = next[i - 1];
    if (!item || !prev) return;
    next[i - 1] = item;
    next[i] = prev;
    clips = next;
  }

  function moveDown(i: number) {
    if (i >= clips.length - 1) return;
    const next = clips.slice();
    const item = next[i];
    const after = next[i + 1];
    if (!item || !after) return;
    next[i + 1] = item;
    next[i] = after;
    clips = next;
  }

  function remove(i: number) {
    const removed = clips[i];
    clips = clips.filter((_, idx) => idx !== i);
    if (removed) URL.revokeObjectURL(removed.url);
  }

  function fmt(s: number): string {
    if (!Number.isFinite(s) || s <= 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    totalInputSize = clips.reduce((s, c) => s + c.file.size, 0);

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const orderedFiles = clips.map((c) => c.file);
      const result = await toolModule.run(orderedFiles, params, {
        onProgress: (p) => {
          progress = p;
        },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      resultSize = blob.size;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
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
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  function download() {
    if (!resultUrl || !resultBlob) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = buildDownloadName(clips[0]?.file.name, tool.id, 'mp4');
    a.click();
  }
</script>

<div class="runner">
  {#if clips.length < (tool.input.max ?? 20)}
    <DropZone
      accept={tool.input.accept}
      multiple={true}
      files={[]}
      bind:error={dropError}
      on:files={onFiles}
    />
  {/if}

  {#if clips.length > 0}
    <div class="strip">
      <div class="strip-header">
        <span class="panel-label">Clip order — joined top to bottom</span>
        <span class="strip-meta">{clips.length} clip{clips.length === 1 ? '' : 's'} · {fmt(totalDuration)}</span>
      </div>
      <ol class="clip-list">
        {#each clips as clip, i (clip.id)}
          <li class="clip-row">
            <span class="clip-index">{i + 1}</span>
            <div class="clip-thumb">
              {#if clip.thumb}
                <img src={clip.thumb} alt="Frame from {clip.file.name}" />
              {:else}
                <span class="thumb-fallback" aria-hidden="true">video</span>
              {/if}
            </div>
            <div class="clip-meta">
              <span class="clip-name" title={clip.file.name}>{clip.file.name}</span>
              <span class="clip-info">
                {fmt(clip.duration)} · {formatBytes(clip.file.size)}
              </span>
            </div>
            <div class="clip-actions">
              <button
                type="button"
                class="btn-icon"
                on:click={() => moveUp(i)}
                disabled={i === 0}
                aria-label="Move up"
                title="Move up"
              >↑</button>
              <button
                type="button"
                class="btn-icon"
                on:click={() => moveDown(i)}
                disabled={i === clips.length - 1}
                aria-label="Move down"
                title="Move down"
              >↓</button>
              <button
                type="button"
                class="btn-icon btn-icon--danger"
                on:click={() => remove(i)}
                aria-label="Remove"
                title="Remove"
              >×</button>
            </div>
          </li>
        {/each}
      </ol>
    </div>

    <ParamsForm
      defaults={tool.defaults}
      paramSchema={tool.paramSchema}
      bind:params
      on:change={(e) => {
        params = e.detail;
      }}
    />
  {/if}

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
        <div class="chain-prominent">
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(clips[0]?.file.name, tool.id, 'mp4')}
          />
        </div>
        <div class="panel-header">
          <span class="panel-label">Result</span>
        </div>
        <div class="panel-divider"></div>
        <!-- svelte-ignore a11y-media-has-caption -->
        <video class="result-media" src={resultUrl} controls></video>
        <div class="panel-divider"></div>
        <div class="solder-row">
          <span class="solder-key">Inputs</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{formatBytes(totalInputSize)}</span>
        </div>
        <div class="solder-row">
          <span class="solder-key">Output</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{formatBytes(resultSize)}</span>
        </div>
        <div class="solder-row">
          <span class="solder-key">Duration</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{fmt(totalDuration)}</span>
        </div>
        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-primary" on:click={download} type="button">Download result</button>
        </div>
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

  .strip {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .strip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .strip-meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }

  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .clip-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .clip-row {
    display: grid;
    grid-template-columns: auto 96px 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .clip-index {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--accent-text);
    font-weight: 500;
    width: 24px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .clip-thumb {
    width: 96px;
    height: 54px;
    border-radius: var(--radius-sm);
    background: #000;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .clip-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-fallback {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .clip-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .clip-name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clip-info {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }

  .clip-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .btn-icon {
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .btn-icon:hover:not(:disabled) {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .btn-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .btn-icon--danger:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .btn-icon:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

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
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-primary:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .btn-primary:focus-visible {
    outline: 2px solid var(--accent-hover);
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
    cursor: pointer;
    align-self: flex-start;
  }

  .btn-secondary:hover {
    background: var(--bg-raised);
    border-color: var(--text-muted);
  }

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

  .result-panel {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
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

  .chain-prominent {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-1);
  }

  .result-media {
    max-width: 100%;
    max-height: 360px;
    border-radius: var(--radius-sm);
    background: #000;
  }

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
  .solder-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .result-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

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
    border-top: 1px solid var(--accent-hover);
    border-left: 1px solid var(--accent-hover);
  }
  .brackets::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
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
    border-top: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }
  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }
</style>
