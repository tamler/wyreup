<script lang="ts">
  import { dropStore } from '../stores/drop';
  import type { ToolModule } from '@wyreup/core';

  // Static scenario data — shown when no file is dropped
  interface Scenario {
    label: string;
    slug: string;
    category: string;
    icon: string;
  }

  const categoryIcons: Record<string, string> = {
    optimize: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
    convert: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>`,
    pdf: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    privacy: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    extract: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    inspect: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    create: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    export: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    dev: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    finance: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="14.5" y2="14.5"/><path d="M12 6v2M12 16v2M8 12H6M18 12h-2"/></svg>`,
    media: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    archive: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  };

  const defaultIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;

  const scenarios: Scenario[] = [
    { label: 'Compress a photo for email', slug: 'compress', category: 'optimize', icon: categoryIcons.optimize },
    { label: 'Merge receipts into one PDF', slug: 'merge-pdf', category: 'pdf', icon: categoryIcons.pdf },
    { label: 'Blur strangers from a vacation photo', slug: 'face-blur', category: 'privacy', icon: categoryIcons.privacy },
    { label: 'Extract text from a scan', slug: 'ocr', category: 'extract', icon: categoryIcons.extract },
    { label: 'Convert HEIC to JPG', slug: 'convert', category: 'convert', icon: categoryIcons.convert },
    { label: 'Generate a QR code', slug: 'qr', category: 'create', icon: categoryIcons.create },
    { label: 'Resize an image for web', slug: 'resize', category: 'edit', icon: categoryIcons.edit },
    { label: 'Redact a contract before sharing', slug: 'pdf-redact', category: 'pdf', icon: categoryIcons.pdf },
  ];

  function clearDrop() {
    dropStore.set(null);
  }

  // Abbreviate MIME for display
  function displayMime(mime: string): string {
    const parts = mime.split('/');
    return parts[parts.length - 1] ?? mime;
  }

  function truncateName(name: string, max = 24): string {
    return name.length > max ? name.slice(0, max) + '...' : name;
  }

  $: drop = $dropStore;
</script>

{#if drop}
  <!-- Compatible tools view -->
  <div class="scenarios-heading-row">
    <h2 class="scenarios-heading">
      Compatible tools for
      <span class="scenarios-heading__file">{truncateName(drop.file.name)}</span>
      <span class="scenarios-heading__mime">({displayMime(drop.mime)})</span>
    </h2>
    <button class="clear-btn" on:click={clearDrop} aria-label="Clear file and return to default view">
      Drop a different file
    </button>
  </div>

  {#if drop.compatibleTools.length === 0}
    <div class="empty-state" role="status">
      <span class="empty-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </span>
      <p class="empty-msg">No tools match this file type yet.</p>
    </div>
  {:else}
    <div class="scenarios-bento">
      {#each drop.compatibleTools.slice(0, 8) as tool, i}
        <a
          href={`/tools/${tool.id}`}
          class="scenario-card"
          style="--stagger-delay: {i * 50}ms"
          aria-label={tool.name}
        >
          <div class="brackets-inner-card" aria-hidden="true"></div>
          <div class="scenario-card__inner">
            <span class="scenario-card__icon">{@html categoryIcons[tool.category] ?? defaultIcon}</span>
            <div class="scenario-card__label">{tool.name}</div>
            <div class="scenario-card__tool">{tool.category}</div>
          </div>
        </a>
      {/each}
    </div>
    {#if drop.compatibleTools.length > 8}
      <p class="more-tools">
        + {drop.compatibleTools.length - 8} more —
        <a href="/tools" class="more-tools__link">browse all tools</a>
      </p>
    {/if}
  {/if}
{:else}
  <!-- Default scenarios view -->
  <h2 class="scenarios-heading">What can you do here, right now?</h2>
  <div class="scenarios-bento">
    {#each scenarios as scenario, i}
      <a
        href={`/tools/${scenario.slug}`}
        class="scenario-card"
        style="--stagger-delay: {i * 50}ms"
        aria-label={scenario.label}
      >
        <div class="brackets-inner-card" aria-hidden="true"></div>
        <div class="scenario-card__inner">
          <span class="scenario-card__icon">{@html scenario.icon}</span>
          <div class="scenario-card__label">{scenario.label}</div>
          <div class="scenario-card__tool">{scenario.slug}</div>
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  .scenarios-heading-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin-bottom: var(--space-8);
  }

  .scenarios-heading {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    font-family: var(--font-sans);
    line-height: 1.1;
    margin-bottom: var(--space-8);
  }

  .scenarios-heading-row .scenarios-heading {
    margin-bottom: 0;
  }

  .scenarios-heading__file {
    color: var(--accent);
  }

  .scenarios-heading__mime {
    font-size: var(--text-xl);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-weight: 400;
  }

  .clear-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      color var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .clear-btn:hover {
    color: var(--text-muted);
    border-color: var(--text-muted);
  }

  .clear-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .scenarios-bento {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  @media (min-width: 960px) {
    .scenarios-bento {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .scenario-card {
    display: block;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    text-decoration: none;
    color: inherit;
    position: relative;
    overflow: visible;
    transition: border-color var(--duration-fast) var(--ease-sharp);
    opacity: 0;
    transform: translateY(8px);
    animation: card-reveal var(--duration-base) var(--ease-out) forwards;
    animation-delay: var(--stagger-delay, 0ms);
  }

  @keyframes card-reveal {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Bracket motif via pseudo-elements */
  .scenario-card::before,
  .scenario-card::after {
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

  .scenario-card::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }

  .scenario-card::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }

  .brackets-inner-card {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .brackets-inner-card::before,
  .brackets-inner-card::after {
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

  .brackets-inner-card::before {
    top: -5px;
    right: -5px;
    border-top: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }

  .brackets-inner-card::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }

  .scenario-card:hover {
    border-color: var(--text-muted);
  }

  .scenario-card:hover::before {
    top: -1px;
    left: -1px;
    border-color: var(--accent);
  }

  .scenario-card:hover::after {
    bottom: -1px;
    right: -1px;
    border-color: var(--accent);
  }

  .scenario-card:hover .brackets-inner-card::before {
    top: -1px;
    right: -1px;
    border-color: var(--accent);
  }

  .scenario-card:hover .brackets-inner-card::after {
    bottom: -1px;
    left: -1px;
    border-color: var(--accent);
  }

  .scenario-card:hover .scenario-card__icon {
    color: var(--accent);
  }

  .scenario-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .scenario-card__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    height: 100%;
  }

  .scenario-card__icon {
    color: var(--text-muted);
    transition: color var(--duration-fast) var(--ease-sharp);
    display: flex;
    align-items: center;
    width: 20px;
    height: 20px;
  }

  .scenario-card__label {
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.35;
    font-family: var(--font-sans);
  }

  .scenario-card__tool {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-weight: 400;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: auto;
  }

  .more-tools {
    margin-top: var(--space-4);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--text-subtle);
  }

  .more-tools__link {
    color: var(--text-muted);
    text-decoration: none;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .more-tools__link:hover {
    color: var(--accent);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12) 0;
    text-align: center;
  }

  .empty-icon {
    color: var(--text-subtle);
    display: flex;
    align-items: center;
  }

  .empty-msg {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .scenarios-bento {
      grid-template-columns: 1fr;
    }

    .scenarios-heading {
      font-size: var(--text-xl);
    }
  }
</style>
