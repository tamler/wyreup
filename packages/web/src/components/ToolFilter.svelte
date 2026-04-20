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
    placeholder="Search tools..."
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
    <span class="empty-icon" aria-hidden="true">[ ]</span>
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
        aria-label={tool.name}
      >
        <div class="tool-card__header">
          <span class="tool-card__icon" aria-hidden="true">[{tool.category.slice(0, 1).toUpperCase()}]</span>
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

  .filter-search:focus {
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
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-weight: 700;
    transition: color var(--duration-fast) var(--ease-sharp);
    flex-shrink: 0;
    margin-top: 2px;
    width: 20px;
    text-align: center;
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
    font-size: var(--text-lg);
    color: var(--text-subtle);
    font-weight: 700;
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
