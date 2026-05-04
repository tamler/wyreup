<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { acquireWakeLock, releaseWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';

  let mediaUrl: string | null = null;
  let mediaEl: HTMLMediaElement | null = null;
  let duration = 0;
  let start = 0;
  let end = 0;
  let streamCopy = false;

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;
  let resultSize = 0;
  let originalSize = 0;
  let resultMime = '';

  let scrubberEl: HTMLDivElement | null = null;
  let dragging: 'start' | 'end' | null = null;
  let previewTimer: number | null = null;

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }

  $: file = files[0] ?? null;
  $: isVideo = file?.type.startsWith('video/') ?? false;

  // Manage object URL lifecycle for the input media — revoke previous,
  // create new whenever the file changes.
  $: {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl);
      mediaUrl = null;
    }
    if (file) mediaUrl = URL.createObjectURL(file);
  }

  $: canRun =
    files.length >= tool.input.min &&
    state !== 'running' &&
    duration > 0 &&
    end > start;

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    duration = 0;
    start = 0;
    end = 0;
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultBlob = null;
  }

  function onMediaLoaded() {
    if (!mediaEl) return;
    duration = mediaEl.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = 0;
      return;
    }
    start = 0;
    end = duration;
  }

  function fmt(s: number): string {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function pctOf(t: number): string {
    if (duration <= 0) return '0%';
    return `${(t / duration) * 100}%`;
  }

  function onPointerDown(handle: 'start' | 'end', e: PointerEvent) {
    if (duration <= 0) return;
    dragging = handle;
    (e.target as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || !scrubberEl || duration <= 0) return;
    const rect = scrubberEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = ratio * duration;
    const minGap = Math.max(0.1, duration * 0.005);
    if (dragging === 'start') {
      start = Math.min(t, end - minGap);
      if (mediaEl) mediaEl.currentTime = start;
    } else {
      end = Math.max(t, start + minGap);
      if (mediaEl) mediaEl.currentTime = end;
    }
  }

  function onPointerUp() {
    dragging = null;
  }

  function previewSelection() {
    if (!mediaEl || duration <= 0) return;
    if (previewTimer != null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    mediaEl.currentTime = start;
    void mediaEl.play();
    const stopAt = end;
    const stop = () => {
      if (!mediaEl) return;
      if (mediaEl.currentTime >= stopAt) {
        mediaEl.pause();
        mediaEl.removeEventListener('timeupdate', stop);
        previewTimer = null;
      }
    };
    mediaEl.addEventListener('timeupdate', stop);
  }

  async function run() {
    if (!canRun || !file) return;
    state = 'running';
    errorMsg = '';
    originalSize = file.size;

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const params = { start, end, stream_copy: streamCopy };
      const result = await toolModule.run(files, params, {
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
      resultMime = blob.type || file.type;
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
    resultBlob = null;
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
  }

  function download() {
    if (!resultUrl || !resultBlob) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    const ext = (file?.name.split('.').pop() ?? resultBlob.type.split('/')[1] ?? 'bin').toLowerCase();
    a.download = buildDownloadName(file?.name, tool.id, ext);
    a.click();
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

  {#if file && mediaUrl}
    <div class="media-frame">
      {#if isVideo}
        <!-- svelte-ignore a11y-media-has-caption -->
        <video
          bind:this={mediaEl}
          src={mediaUrl}
          controls
          preload="metadata"
          on:loadedmetadata={onMediaLoaded}
        ></video>
      {:else}
        <audio
          bind:this={mediaEl}
          src={mediaUrl}
          controls
          preload="metadata"
          on:loadedmetadata={onMediaLoaded}
        ></audio>
      {/if}
    </div>

    {#if duration > 0}
      <div class="scrubber-block">
        <div
          class="scrubber"
          bind:this={scrubberEl}
          on:pointermove={onPointerMove}
          on:pointerup={onPointerUp}
          on:pointercancel={onPointerUp}
        >
          <div class="scrubber__track" aria-hidden="true"></div>
          <div
            class="scrubber__range"
            style="left: {pctOf(start)}; right: calc(100% - {pctOf(end)})"
            aria-hidden="true"
          ></div>
          <div
            class="scrubber__handle scrubber__handle--start"
            style="left: {pctOf(start)}"
            on:pointerdown={(e) => onPointerDown('start', e)}
            role="slider"
            tabindex="0"
            aria-label="Start time"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={start}
          ></div>
          <div
            class="scrubber__handle scrubber__handle--end"
            style="left: {pctOf(end)}"
            on:pointerdown={(e) => onPointerDown('end', e)}
            role="slider"
            tabindex="0"
            aria-label="End time"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={end}
          ></div>
        </div>

        <div class="time-row">
          <div class="time-cell">
            <span class="time-label">Start</span>
            <span class="time-val">{fmt(start)}</span>
          </div>
          <div class="time-cell">
            <span class="time-label">End</span>
            <span class="time-val">{fmt(end)}</span>
          </div>
          <div class="time-cell">
            <span class="time-label">Selected</span>
            <span class="time-val">{fmt(end - start)}</span>
          </div>
          <button class="btn-secondary" type="button" on:click={previewSelection}>
            Preview selection
          </button>
        </div>

        <label class="opt-row">
          <input type="checkbox" bind:checked={streamCopy} />
          <span class="opt-label">Fast trim (no re-encode — may snap to nearest keyframe)</span>
        </label>
      </div>
    {/if}
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
            resultName={buildDownloadName(file?.name, tool.id, file?.name.split('.').pop() ?? 'bin')}
          />
        </div>

        <div class="panel-header">
          <span class="panel-label">Result</span>
        </div>
        <div class="panel-divider"></div>

        {#if resultMime.startsWith('video/')}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video class="result-media" src={resultUrl} controls></video>
        {:else if resultMime.startsWith('audio/')}
          <audio class="result-media" src={resultUrl} controls></audio>
        {/if}

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
        <div class="solder-row">
          <span class="solder-key">Range</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{fmt(start)} → {fmt(end)}</span>
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

  .media-frame {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    justify-content: center;
  }

  .media-frame video {
    max-width: 100%;
    max-height: 360px;
    border-radius: var(--radius-sm);
    background: #000;
  }

  .media-frame audio {
    width: 100%;
  }

  .scrubber-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .scrubber {
    position: relative;
    height: 32px;
    margin: 0 12px;
    cursor: pointer;
    touch-action: none;
  }

  .scrubber__track {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 4px;
    transform: translateY(-50%);
    background: var(--border);
    border-radius: 2px;
  }

  .scrubber__range {
    position: absolute;
    top: 50%;
    height: 4px;
    transform: translateY(-50%);
    background: var(--accent);
    border-radius: 2px;
  }

  .scrubber__handle {
    position: absolute;
    top: 50%;
    width: 16px;
    height: 16px;
    margin-left: -8px;
    transform: translateY(-50%);
    background: var(--bg);
    border: 2px solid var(--accent-hover);
    border-radius: 50%;
    cursor: grab;
    touch-action: none;
    transition: transform var(--duration-instant) var(--ease-sharp);
  }

  .scrubber__handle:hover,
  .scrubber__handle:focus-visible {
    transform: translateY(-50%) scale(1.15);
  }

  .scrubber__handle:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .scrubber__handle:active {
    cursor: grabbing;
  }

  .time-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .time-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 70px;
  }

  .time-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .time-val {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .opt-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    cursor: pointer;
  }

  .opt-row input[type='checkbox'] {
    accent-color: var(--accent);
  }

  .opt-label {
    user-select: none;
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
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-secondary:hover {
    background: var(--bg-raised);
    border-color: var(--text-muted);
  }
  .btn-secondary:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
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
  .solder-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
    min-width: 80px;
    text-align: right;
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
    border-left: 1px solid var(--accent-hover);
  }
</style>
