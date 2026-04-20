<script lang="ts">
  import { onMount } from 'svelte';

  interface Tool {
    id: string;
    name: string;
    category: string;
    description: string;
    requiresWebgpu?: 'preferred' | 'required';
  }

  export let tools: Tool[] = [];
  export let categories: string[] = [];

  // Inline SVG icons per category (Lucide-style: 20px, 1.5px stroke)
  const categoryIcons: Record<string, string> = {
    optimize: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
    convert: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>`,
    pdf: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    inspect: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    create: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    privacy: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    extract: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    generate: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 5.34L3.93 6.75M19.07 19.07l-1.41-1.41M5.34 18.66l-1.41 1.41M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>`,
    text: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    dev: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    image: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    export: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  };
  const defaultIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;

  let query = '';
  let activeCategories: Set<string> = new Set();
  let filtered: Tool[] = tools;

  function toggleCategory(cat: string) {
    const next = new Set(activeCategories);
    if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    activeCategories = next;
    applyFilter();
  }

  function applyFilter() {
    const q = query.toLowerCase().trim();
    filtered = tools.filter((t) => {
      const catMatch = activeCategories.size === 0 || activeCategories.has(t.category);
      if (!catMatch) return false;
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }

  function clearAll() {
    query = '';
    activeCategories = new Set();
    filtered = tools;
  }

  $: {
    query;
    activeCategories;
    applyFilter();
  }
</script>

<div class="filter-bar">
  <input
    class="filter-search"
    type="search"
    placeholder="Search tools"
    bind:value={query}
    aria-label="Search tools"
  />
  <div class="filter-chips" role="group" aria-label="Filter by category">
    {#each categories as cat}
      <button
        class="filter-chip"
        class:active={activeCategories.has(cat)}
        on:click={() => toggleCategory(cat)}
        aria-pressed={activeCategories.has(cat)}
      >
        {cat}
      </button>
    {/each}
  </div>
</div>

<div class="results-meta">
  <span class="results-count">{filtered.length} tool{filtered.length !== 1 ? 's' : ''}</span>
  {#if query || activeCategories.size > 0}
    <button class="clear-btn" on:click={clearAll}>Clear</button>
  {/if}
</div>

{#if filtered.length === 0}
  <div class="empty-state" role="status">
    <span class="empty-icon" aria-hidden="true">{@html `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`}</span>
    <p class="empty-msg">No tools match {query ? `"${query}"` : 'this filter'}.</p>
    <button class="btn-ghost" on:click={clearAll}>Clear filter</button>
  </div>
{:else}
  <div class="tool-grid" role="list">
    {#each filtered as tool (tool.id)}
      <a
        href={`/tools/${tool.id}`}
        class="tool-card"
        role="listitem"
        aria-label="{tool.name} — {tool.category}"
      >
        <div class="tool-card__header">
          <span class="tool-card__icon">{@html categoryIcons[tool.category] ?? defaultIcon}</span>
          <div>
            <div class="tool-card__name">{tool.name}</div>
            <div class="tool-card__category">{tool.category}</div>
          </div>
          {#if tool.requiresWebgpu === 'required'}
            <span class="badge badge--required" title="Requires WebGPU">WebGPU only</span>
          {:else if tool.requiresWebgpu === 'preferred'}
            <span class="badge badge--preferred" title="Faster with WebGPU">Faster on WebGPU</span>
          {/if}
        </div>
        <div class="tool-card__divider" aria-hidden="true"></div>
        <p class="tool-card__desc">{tool.description}</p>
      </a>
    {/each}
  </div>
{/if}

<style>
  /* Filter bar */
  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .filter-search {
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-base);
    width: 100%;
    max-width: 360px;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .filter-search::placeholder {
    color: var(--text-subtle);
  }

  .filter-search:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-color: var(--border);
  }

  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-chip {
    height: 28px;
    padding: 0 var(--space-3);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp),
      background var(--duration-instant) var(--ease-sharp);
  }

  .filter-chip:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .filter-chip.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-dim);
  }

  .filter-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Results meta */
  .results-meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .clear-btn {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .clear-btn:hover {
    color: var(--text-muted);
  }

  /* Tool grid */
  .tool-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
  }

  @media (max-width: 1024px) {
    .tool-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 768px) {
    .tool-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .tool-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Tool card */
  .tool-card {
    display: block;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    text-decoration: none;
    color: inherit;
    transition:
      border-color var(--duration-fast) var(--ease-sharp),
      background var(--duration-fast) var(--ease-sharp);
  }

  .tool-card:hover {
    border-color: var(--text-muted);
    background: var(--bg-raised);
  }

  .tool-card:hover .tool-card__icon {
    color: var(--accent);
  }

  .tool-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .tool-card__header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }

  .tool-card__icon {
    color: var(--text-muted);
    transition: color var(--duration-fast) var(--ease-sharp);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    width: 20px;
    height: 20px;
  }

  .tool-card__name {
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.25;
  }

  .tool-card__category {
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: var(--space-1);
  }

  .tool-card__divider {
    height: 1px;
    background: var(--border-subtle);
    margin-bottom: var(--space-3);
  }

  .tool-card__desc {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* WebGPU badges */
  .badge {
    display: inline-block;
    font-size: var(--text-xs);
    font-weight: 500;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-left: auto;
    flex-shrink: 0;
  }

  .badge--required {
    background: var(--accent-dim);
    color: var(--accent);
    border: 1px solid var(--accent);
  }

  .badge--preferred {
    background: var(--bg-raised);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12) 0;
    text-align: center;
    color: var(--text-muted);
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

  .btn-ghost {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .btn-ghost:hover {
    color: var(--text-muted);
  }

  .btn-ghost:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
