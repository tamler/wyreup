<script lang="ts">
  import { mimeMatches } from '@wyreup/core';
  import { encodeChainSteps, type ChainStepSpec } from './runners/chainUrl';
  import { stashChainFile } from './runners/chainStorage';

  type SerializedJobAction =
    | { kind: 'tool'; toolId: string; params?: Record<string, unknown> }
    | { kind: 'chain'; steps: ChainStepSpec[] };

  interface SerializedJob {
    slug: string;
    title: string;
    action: SerializedJobAction;
    acceptMimes: string[];
  }

  export let job: SerializedJob;

  let fileInput: HTMLInputElement;
  let dropButton: HTMLButtonElement;
  let isDragOver = false;
  let isHandingOff = false;
  let error = '';
  let handoffFailed = false;

  const MIME_LABELS: Record<string, string> = {
    'image/*': 'image files',
    'image/heic': 'HEIC images',
    'image/heif': 'HEIF images',
    'audio/*': 'audio files',
    'video/*': 'video files',
    'application/pdf': 'PDF files',
    'text/csv': 'CSV files',
  };
  const MIME_EXTENSIONS: Record<string, string[]> = {
    'image/*': ['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'],
    'image/heic': ['heic'],
    'image/heif': ['heif'],
    'audio/*': ['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba'],
    'video/*': ['m4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm'],
    'application/pdf': ['pdf'],
    'text/csv': ['csv'],
  };

  $: targetUrl =
    job.action.kind === 'tool'
      ? `/tools/${job.action.toolId}`
      : `/chain/run?steps=${encodeURIComponent(encodeChainSteps(job.action.steps))}`;
  $: acceptLabel = formatReadableList(
    job.acceptMimes.map((mime) => MIME_LABELS[mime] ?? mime),
  );
  $: actionLabel = `${job.title.charAt(0).toLowerCase()}${job.title.slice(1)}`;

  function formatReadableList(items: string[]): string {
    if (items.length === 0) return 'a supported file type';
    if (items.length === 1) return items[0]!;
    if (items.length === 2) return `${items[0]} or ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
  }

  function openFilePicker(): void {
    fileInput.value = '';
    fileInput.click();
  }

  function handleInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void handOff(file);
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!isHandingOff) isDragOver = true;
  }

  function handleDragLeave(event: DragEvent): void {
    if (!dropButton.contains(event.relatedTarget as Node | null)) {
      isDragOver = false;
    }
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    isDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void handOff(file);
  }

  function acceptsFile(file: File): boolean {
    if (job.acceptMimes.some((pattern) => mimeMatches(file.type, pattern))) return true;
    if (file.type) return false;

    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension
      ? job.acceptMimes.some((pattern) => MIME_EXTENSIONS[pattern]?.includes(extension))
      : false;
  }

  async function handOff(file: File): Promise<void> {
    if (isHandingOff) return;

    error = '';
    handoffFailed = false;
    if (!acceptsFile(file)) {
      error = `This page expects ${acceptLabel}.`;
      return;
    }

    isHandingOff = true;
    const stashed = await stashChainFile(file);
    if (stashed) {
      window.location.assign(targetUrl);
      return;
    }

    error = 'Could not hand the file off — open the tool directly:';
    handoffFailed = true;
    isHandingOff = false;
  }
</script>

<div class="job-launcher">
  <input
    class="file-input"
    bind:this={fileInput}
    type="file"
    accept={job.acceptMimes.join(',')}
    on:change={handleInput}
  />
  <button
    class="job-drop"
    class:dragover={isDragOver}
    bind:this={dropButton}
    type="button"
    disabled={isHandingOff}
    aria-describedby={error ? 'job-launcher-error' : undefined}
    on:click={openFilePicker}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
  >
    <span class="brackets-inner" aria-hidden="true"></span>
    <span class="job-drop__inner">
      <span class="job-drop__icon" aria-hidden="true">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </span>
      <span class="job-drop__caption">
        {isHandingOff
          ? 'Opening your job…'
          : isDragOver
            ? `Release to ${actionLabel}.`
            : `Drop a file to ${actionLabel}.`}
      </span>
      <span class="job-drop__sub">or click to pick a file</span>
      <span class="job-drop__accept">Accepts {acceptLabel}</span>
    </span>
  </button>

  {#if error}
    <p id="job-launcher-error" class="error-row" role="alert">
      <span>{error}</span>
      {#if handoffFailed}<a href={targetUrl}>Open directly</a>{/if}
    </p>
  {/if}
</div>

<style>
  .job-launcher {
    margin-bottom: var(--space-4);
  }

  .file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .job-drop {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 320px;
    padding: 1px;
    overflow: visible;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-sharp),
      background var(--duration-fast) var(--ease-sharp);
  }

  .job-drop:hover,
  .job-drop.dragover {
    border-color: var(--accent-hover);
    background: var(--accent-dim);
  }

  .job-drop:disabled {
    cursor: wait;
  }

  .job-drop:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .job-drop::before,
  .job-drop::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      top var(--duration-fast) var(--ease-out),
      right var(--duration-fast) var(--ease-out),
      bottom var(--duration-fast) var(--ease-out),
      left var(--duration-fast) var(--ease-out);
  }

  .job-drop::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }

  .job-drop::after {
    right: -5px;
    bottom: -5px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
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
    transition:
      border-color var(--duration-fast) var(--ease-out),
      top var(--duration-fast) var(--ease-out),
      right var(--duration-fast) var(--ease-out),
      bottom var(--duration-fast) var(--ease-out),
      left var(--duration-fast) var(--ease-out);
  }

  .brackets-inner::before {
    top: -5px;
    right: -5px;
    border-top: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }

  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }

  .job-drop:hover::before,
  .job-drop.dragover::before {
    top: -1px;
    left: -1px;
    border-color: var(--accent-hover);
  }

  .job-drop:hover::after,
  .job-drop.dragover::after {
    right: -1px;
    bottom: -1px;
    border-color: var(--accent-hover);
  }

  .job-drop:hover .brackets-inner::before,
  .job-drop.dragover .brackets-inner::before {
    top: -1px;
    right: -1px;
    border-color: var(--accent-hover);
  }

  .job-drop:hover .brackets-inner::after,
  .job-drop.dragover .brackets-inner::after {
    bottom: -1px;
    left: -1px;
    border-color: var(--accent-hover);
  }

  .job-drop__inner {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    background: var(--bg-raised);
    text-align: center;
    transition: background var(--duration-fast) var(--ease-sharp);
  }

  .job-drop:hover .job-drop__inner,
  .job-drop.dragover .job-drop__inner {
    background: var(--accent-dim);
  }

  .job-drop__icon {
    display: flex;
    align-items: center;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    transition: color var(--duration-fast) var(--ease-sharp);
  }

  .job-drop:hover .job-drop__icon,
  .job-drop.dragover .job-drop__icon {
    color: var(--accent-text);
  }

  .job-drop__caption {
    font-size: var(--text-md);
    font-weight: 500;
    line-height: 1.35;
    color: var(--text-primary);
  }

  .job-drop__sub {
    font-size: var(--text-sm);
    line-height: 1.4;
    color: var(--accent-text);
  }

  .job-drop__accept {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-subtle);
  }

  .error-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-4) 0 0;
    padding: var(--space-3) var(--space-4);
    border-left: 2px solid var(--danger);
    background: var(--bg-elevated);
    font-size: var(--text-sm);
    color: var(--danger-text);
  }

  .error-row a {
    color: var(--text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  @media (max-width: 640px) {
    .job-drop {
      min-height: 280px;
    }

    .job-drop__inner {
      padding: var(--space-6);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .job-drop,
    .job-drop::before,
    .job-drop::after,
    .brackets-inner::before,
    .brackets-inner::after,
    .job-drop__inner,
    .job-drop__icon {
      transition: none;
    }
  }
</style>
