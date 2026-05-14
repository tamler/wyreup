<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createDefaultRegistry } from '@wyreup/core';
  import { dropStore } from '../stores/drop';

  let isDragOver = false;
  let zone: HTMLElement;
  let heroSection: HTMLElement | null = null;

  // When arriving here from /share-receive (PWA Web Share Target), read the
  // file stashed in sessionStorage and populate the drop store automatically.
  onMount(() => {
    try {
      const raw = sessionStorage.getItem('wyreup:shared-file');
      if (raw) {
        sessionStorage.removeItem('wyreup:shared-file');
        const payload = JSON.parse(raw) as { name: string; type: string; data: number[] };
        const uint8 = new Uint8Array(payload.data);
        const file = new File([uint8], payload.name, { type: payload.type });
        processFile(file);
      }
    } catch (err) {
      console.error('Failed to consume shared file:', err);
    }

    // Treat the entire hero section as a drop target. Listeners live on the
    // section so dragging anywhere in the hero (not just the visible card)
    // registers as a drop.
    heroSection = document.getElementById('hero-drop-zone');
    if (heroSection) {
      heroSection.addEventListener('dragover', handleDragOver);
      heroSection.addEventListener('dragleave', handleDragLeave);
      heroSection.addEventListener('drop', handleDrop);
    }

    // Drops outside the hero (further down the homepage) get caught by the
    // site-wide safety net in BaseLayout and broadcast via this event.
    document.addEventListener('wyreup:filedrop', handleGlobalFileDrop);
  });

  onDestroy(() => {
    // onDestroy runs on the server during SSR teardown too; guard so we
    // don't touch browser globals there.
    if (typeof document === 'undefined') return;
    if (heroSection) {
      heroSection.removeEventListener('dragover', handleDragOver);
      heroSection.removeEventListener('dragleave', handleDragLeave);
      heroSection.removeEventListener('drop', handleDrop);
    }
    document.removeEventListener('wyreup:filedrop', handleGlobalFileDrop);
  });

  function handleGlobalFileDrop(e: Event) {
    const files = (e as CustomEvent<{ files: FileList }>).detail?.files;
    const file = files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!isDragOver) {
      isDragOver = true;
      heroSection?.classList.add('hero--dragover');
    }
  }

  function handleDragLeave(e: DragEvent) {
    // Only clear when leaving the section itself, not when moving to a child
    if (heroSection && !heroSection.contains(e.relatedTarget as Node)) {
      isDragOver = false;
      heroSection.classList.remove('hero--dragover');
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    heroSection?.classList.remove('hero--dragover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    processFile(file);
  }

  function handleClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) processFile(file);
    };
    input.click();
  }

  function processFile(file: File) {
    const mime = file.type || 'application/octet-stream';
    const registry = createDefaultRegistry();
    const compatibleTools = registry.toolsForFiles([file]);
    dropStore.set({ file, mime, compatibleTools });

    // Scroll to scenarios section after brief delay so Svelte re-renders first
    requestAnimationFrame(() => {
      const section = document.getElementById('scenarios-section');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="hero-drop"
  class:dragover={isDragOver}
  bind:this={zone}
  role="button"
  tabindex="0"
  aria-label="Drop a file anywhere in the hero, or click to browse"
  on:click={handleClick}
  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
>
  <div class="brackets-inner" aria-hidden="true"></div>
  <div class="hero-drop__inner">
    <span class="hero-drop__icon" aria-hidden="true">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    </span>
    <p class="hero-drop__caption">
      {isDragOver ? 'Release to detect compatible tools.' : 'Drop a file to see what you can do.'}
    </p>
    <p class="hero-drop__sub">Nothing uploads. Everything runs on this device.</p>
  </div>
</div>

<style>
  .hero-drop {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    overflow: visible;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-sharp),
      background var(--duration-fast) var(--ease-sharp);
    min-height: 360px;
    display: flex;
    flex-direction: column;
  }

  .hero-drop:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  /* Corner bracket motif — same pattern as .brackets in motifs.css */
  .hero-drop::before,
  .hero-drop::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      top var(--duration-fast) var(--ease-out),
      left var(--duration-fast) var(--ease-out),
      bottom var(--duration-fast) var(--ease-out),
      right var(--duration-fast) var(--ease-out);
  }

  .hero-drop::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }

  .hero-drop::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
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

  /* Dragover: brackets lock on amber, bg shifts */
  .hero-drop.dragover {
    border-color: var(--accent-hover);
    background: var(--accent-dim);
  }

  .hero-drop.dragover::before {
    top: -1px;
    left: -1px;
    border-color: var(--accent-hover);
  }

  .hero-drop.dragover::after {
    bottom: -1px;
    right: -1px;
    border-color: var(--accent-hover);
  }

  .hero-drop.dragover .brackets-inner::before {
    top: -1px;
    right: -1px;
    border-color: var(--accent-hover);
  }

  .hero-drop.dragover .brackets-inner::after {
    bottom: -1px;
    left: -1px;
    border-color: var(--accent-hover);
  }

  .hero-drop__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-8);
    text-align: center;
    transition: background var(--duration-fast) var(--ease-sharp);
  }

  .hero-drop.dragover .hero-drop__inner {
    background: var(--accent-dim);
  }

  .hero-drop__icon {
    color: var(--text-muted);
    display: flex;
    align-items: center;
    transition: color var(--duration-fast) var(--ease-sharp);
  }

  .hero-drop.dragover .hero-drop__icon {
    color: var(--accent-text);
  }

  .hero-drop__caption {
    font-size: var(--text-md);
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.35;
    transition: color var(--duration-fast) var(--ease-sharp);
  }

  .hero-drop.dragover .hero-drop__caption {
    color: var(--accent-text);
  }

  .hero-drop__sub {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--text-subtle);
    line-height: 1.4;
  }
</style>
