<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let accept: string[] = ['*/*'];
  export let multiple: boolean = false;
  export let label: string = 'Drop file or click to browse';
  export let files: File[] = [];
  export let error: string = '';

  const dispatch = createEventDispatcher<{ files: File[] }>();

  let isDragOver = false;
  let zone: HTMLElement;

  // Drops outside any specific zone are caught by the site-wide safety net
  // in BaseLayout and re-dispatched as `wyreup:filedrop`. Each mounted
  // DropZone listens for that event and runs the file through its own
  // accept-list — so dropping a JPG on a JPG-only tool page works
  // wherever the cursor lands, and a mismatched file shows the same
  // error message it would on a direct hit.
  onMount(() => {
    document.addEventListener('wyreup:filedrop', handleGlobalFileDrop);
  });

  onDestroy(() => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('wyreup:filedrop', handleGlobalFileDrop);
  });

  function handleGlobalFileDrop(e: Event) {
    // A matched trigger rule preventDefaults this event. When that
    // happens, the trigger preview sheet is the surface in charge —
    // we don't also load the file into this runner. See
    // docs/triggers-security.md G1.
    if (e.defaultPrevented) return;
    const detail = (e as CustomEvent<{ files: FileList }>).detail;
    const incoming = Array.from(detail?.files ?? []);
    if (incoming.length === 0) return;
    handleFiles(incoming);
  }

  function matchesMime(file: File): boolean {
    if (accept.includes('*/*') || accept.includes('*')) return true;
    return accept.some((pattern) => {
      if (pattern.endsWith('/*')) return file.type.startsWith(pattern.slice(0, -1));
      return file.type === pattern;
    });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    if (!zone.contains(e.relatedTarget as Node)) isDragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    handleFiles(dropped);
  }

  function handleClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept.length && !accept.includes('*/*') && !accept.includes('*')) {
      input.accept = accept.join(',');
    }
    input.onchange = () => {
      handleFiles(Array.from(input.files ?? []));
    };
    input.click();
  }

  function handleFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const valid = incoming.filter(matchesMime);
    if (valid.length === 0) {
      const types = accept.join(', ');
      dispatch('files', []);
      // Signal error via parent
      files = [];
      error = `File type not accepted. Expected: ${types}`;
      return;
    }
    error = '';
    files = multiple ? valid : [valid[0]!];
    dispatch('files', files);
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="drop-zone"
  class:dragover={isDragOver}
  class:has-files={files.length > 0}
  class:has-error={!!error}
  bind:this={zone}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
  on:click={handleClick}
  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
  role="button"
  tabindex="0"
  aria-label={label}
>
  <div class="brackets-inner" aria-hidden="true"></div>
  <div class="drop-zone__inner">
    {#if files.length > 0}
      <span class="drop-zone__icon accepted" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
      <div class="drop-zone__files">
        {#each files as f}
          <span class="drop-zone__filename">{f.name}</span>
        {/each}
      </div>
      <button
        class="btn-ghost drop-zone__change"
        on:click|stopPropagation={handleClick}
        type="button"
      >Change</button>
    {:else if error}
      <span class="drop-zone__icon error-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </span>
      <p class="drop-zone__error-msg">{error}</p>
      <p class="drop-zone__hint">Click to try a different file.</p>
    {:else}
      <span class="drop-zone__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </span>
      <p class="drop-zone__label">{isDragOver ? 'Release to load.' : label}</p>
      <p class="drop-zone__hint">Drop a file or click to browse — nothing uploads.</p>
    {/if}
  </div>
</div>

<style>
  .drop-zone {
    position: relative;
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    overflow: visible;
    cursor: pointer;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    transition:
      border-color var(--duration-fast) var(--ease-sharp),
      background var(--duration-fast) var(--ease-sharp);
  }

  .drop-zone:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .drop-zone.dragover {
    border-color: var(--accent-hover);
    border-style: solid;
    background: var(--accent-dim);
  }

  .drop-zone.has-files {
    border-style: solid;
    border-color: var(--success);
  }

  .drop-zone.has-error {
    border-style: solid;
    border-color: var(--danger);
  }

  .brackets-inner {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .drop-zone__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    text-align: center;
    transition: background var(--duration-fast) var(--ease-sharp);
  }

  .drop-zone.dragover .drop-zone__inner {
    background: var(--accent-dim);
  }

  .drop-zone__icon {
    color: var(--text-muted);
    display: flex;
    align-items: center;
    transition: color var(--duration-fast) var(--ease-sharp);
  }

  .drop-zone__icon.accepted {
    color: var(--success);
  }

  .drop-zone__icon.error-icon {
    color: var(--danger);
  }

  .drop-zone.dragover .drop-zone__icon {
    color: var(--accent-text);
  }

  .drop-zone__label {
    font-size: var(--text-base);
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.35;
  }

  .drop-zone__hint {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--text-subtle);
  }

  .drop-zone__files {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .drop-zone__filename {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--text-primary);
  }

  .drop-zone__error-msg {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--danger);
  }

  .drop-zone__change {
    margin-top: var(--space-1);
  }

  .btn-ghost {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .btn-ghost:hover {
    color: var(--text-muted);
  }

  .btn-ghost:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }
</style>
