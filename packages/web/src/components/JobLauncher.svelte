<script lang="ts">
  import { onDestroy } from 'svelte';
import { fileMatchesMime, createDefaultRegistry } from '@wyreup/core/execution';
  import { encodeChainSteps, type ChainStepSpec } from './runners/chainUrl';
  import { stashChainHandover, clearChainHandover } from './runners/chainStorage';
  import { clearTrail, setTrailHandover } from './runners/hopTrail';
  import { acceptsBrowserFile } from '../lib/file-tool-candidates';

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
  let original: File | null = null;
  let disposed = false;
  const downloadUrls = new Set<string>();
  const downloadTimers = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => { disposed = true; for (const url of downloadUrls) URL.revokeObjectURL(url); for (const timer of downloadTimers) clearTimeout(timer); });

  const MIME_LABELS: Record<string, string> = {
    'image/*': 'image files',
    'image/heic': 'HEIC images',
    'image/heif': 'HEIF images',
    'audio/*': 'audio files',
    'video/*': 'video files',
    'application/pdf': 'PDF files',
    'text/csv': 'CSV files',
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
    return fileMatchesMime(file, job.acceptMimes);
  }

  async function handOff(file: File): Promise<void> {
    if (isHandingOff) return;

    error = '';
    handoffFailed = false;
    if (!acceptsFile(file)) {
      error = `This page expects ${acceptLabel}.`;
      return;
    }

    original = file;
    const action = job.action;
    const registry = createDefaultRegistry();
    const firstId = action.kind === 'tool' ? action.toolId : action.steps[0]?.toolId;
    const first = firstId ? registry.toolsById.get(firstId) : undefined;
    if (!first || !acceptsBrowserFile(first, file) || (action.kind === 'chain' && action.steps.some((step) => !registry.toolsById.has(step.toolId)))) {
      error = 'This job cannot import the original. Download it or choose another tool.'; handoffFailed = true; return;
    }
    const capturedJob = job, destination = targetUrl;
    isHandingOff = true;
    const result = await stashChainHandover(file, action.kind === 'tool' ? { autoAccept: true, targetToolId: first.id } : { autoAccept: false });
    if (disposed || job !== capturedJob) {
      const cleared = !result.stored || await clearChainHandover(result.token);
      if (!cleared && !disposed) { error = 'Shared storage could not confirm deleting this handover token. Original retained.'; handoffFailed = true; }
      isHandingOff = false; return;
    }
    if (result.stored && (action.kind === 'chain' || setTrailHandover([], result.token, first.id))) {
      if (action.kind === 'chain') clearTrail();
      window.location.assign(destination);
      return;
    }

    const cleared = !result.stored || await clearChainHandover(result.token);
    error = 'Could not complete the handover. Original retained; download it or retry.' + (cleared ? '' : ' Shared storage could not confirm deleting this token.');
    handoffFailed = true;
    isHandingOff = false;
  }

  function downloadOriginal(): void {
    if (!original) return;
    const url = URL.createObjectURL(original); downloadUrls.add(url);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = original.name; anchor.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); downloadTimers.delete(timer); }, 1000);
    downloadTimers.add(timer);
  }
</script>

<div class="job-launcher">
  <input
    class="file-input"
    bind:this={fileInput}
    type="file"
    tabindex="-1"
    aria-hidden="true"
    accept={job.acceptMimes.join(',')}
    on:change={handleInput}
  />
  <button
    class="job-drop"
    class:dragover={isDragOver}
    bind:this={dropButton}
    type="button"
    disabled={isHandingOff}
    aria-label={`Choose a file to ${actionLabel}`}
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
      {#if handoffFailed}<button type="button" on:click={downloadOriginal}>Download original</button>{/if}
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
