<script lang="ts">
  import { onMount } from 'svelte';

  interface SidebarTool {
    id: string;
    name: string;
    category: string;
  }

  export let tools: SidebarTool[] = [];
  // currentPath passed from Astro at build time for SSR active state;
  // overridden on the client by onMount so navigation within the page works.
  export let currentPath: string = '';

  const STORAGE_KEY = 'wyreup:sidebar-collapsed';

  // Derive sorted categories from tools
  $: categories = [...new Set(tools.map((t) => t.category))].sort();

  // Collapse state per category — persisted
  let collapsed: Record<string, boolean> = {};

  // Search query
  let query = '';

  // Active path — initialized from prop (works in SSR), updated on client
  let activePath = currentPath;

  // Mobile overlay open
  let mobileOpen = false;

  onMount(() => {
    // Override with live pathname in case of client-side navigation
    activePath = window.location.pathname;

    // Load persisted collapse state
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) collapsed = JSON.parse(stored);
    } catch {
      // ignore
    }

    // Update on navigation (popstate for SPA-like usage)
    const handlePopstate = () => {
      activePath = window.location.pathname;
    };
    window.addEventListener('popstate', handlePopstate);

    // Close mobile sidebar on Escape
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        mobileOpen = false;
      }
    };
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('popstate', handlePopstate);
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  function toggleCategory(cat: string) {
    collapsed = { ...collapsed, [cat]: !collapsed[cat] };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      // ignore
    }
  }

  function toolsInCategory(cat: string): SidebarTool[] {
    const q = query.toLowerCase().trim();
    return tools.filter((t) => {
      if (t.category !== cat) return false;
      if (!q) return true;
      return t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
    });
  }

  $: filteredCategories = categories.filter((cat) => toolsInCategory(cat).length > 0);

  $: totalFiltered = tools.filter((t) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  }).length;

  function closeMobile() {
    mobileOpen = false;
  }
</script>

<!-- Mobile trigger button -->
<button
  class="sidebar-trigger"
  aria-label="Open tool navigation"
  aria-expanded={mobileOpen}
  on:click={() => (mobileOpen = true)}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
</button>

<!-- Mobile scrim -->
{#if mobileOpen}
  <div class="sidebar-scrim" aria-hidden="true" on:click={closeMobile}></div>
{/if}

<!-- Sidebar panel -->
<aside
  class="sidebar"
  class:sidebar--open={mobileOpen}
  aria-label="All tools"
>
  <!-- Search -->
  <div class="sidebar__search-wrap">
    <input
      class="sidebar__search"
      type="search"
      placeholder="Filter tools"
      aria-label="Filter tools"
      bind:value={query}
    />
  </div>

  <!-- Meta row -->
  <div class="sidebar__meta" aria-hidden="true">
    <span class="sidebar__meta-line"></span>
    <span class="sidebar__meta-pad"></span>
    <span class="sidebar__meta-count">{totalFiltered} tools</span>
  </div>

  <!-- Category list -->
  <nav class="sidebar__nav" aria-label="Tool categories">
    {#each filteredCategories as cat}
      {@const catTools = toolsInCategory(cat)}
      {@const isCollapsed = !!collapsed[cat]}
      <div class="sidebar__cat">
        <button
          class="sidebar__cat-head"
          aria-expanded={!isCollapsed}
          aria-controls={`sidebar-cat-${cat}`}
          on:click={() => toggleCategory(cat)}
        >
          <span class="sidebar__chevron" class:sidebar__chevron--collapsed={isCollapsed} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
          <span class="sidebar__cat-label">{cat}</span>
          <span class="sidebar__cat-count">({catTools.length})</span>
        </button>

        {#if !isCollapsed}
          <ul
            id={`sidebar-cat-${cat}`}
            class="sidebar__tool-list"
            role="list"
          >
            {#each catTools as tool}
              <li class="sidebar__tool-item">
                {#if activePath === `/tools/${tool.id}`}
                  <span class="sidebar__active-marker" aria-hidden="true"></span>
                {/if}
                <a
                  href={`/tools/${tool.id}`}
                  class="sidebar__tool-link"
                  class:sidebar__tool-link--active={activePath === `/tools/${tool.id}`}
                  aria-current={activePath === `/tools/${tool.id}` ? 'page' : undefined}
                  on:click={closeMobile}
                >
                  {tool.name}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    {#if filteredCategories.length === 0}
      <p class="sidebar__empty">No tools match "{query}".</p>
    {/if}
  </nav>
</aside>

<style>
  /* ── Mobile trigger ── */
  .sidebar-trigger {
    display: none;
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 100;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--accent);
    cursor: pointer;
    align-items: center;
    justify-content: center;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }

  .sidebar-trigger:hover {
    background: var(--bg-raised);
    border-color: var(--text-muted);
  }

  .sidebar-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ── Scrim ── */
  .sidebar-scrim {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 49;
    background: rgba(10, 10, 10, 0.7);
  }

  /* ── Sidebar panel ── */
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: var(--bg-elevated);
    border-right: 1px solid var(--border);
    height: calc(100vh - 48px);
    position: sticky;
    top: 48px;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
  }

  /* Scrollbar styling */
  .sidebar::-webkit-scrollbar {
    width: 4px;
  }
  .sidebar::-webkit-scrollbar-track {
    background: transparent;
  }
  .sidebar::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }

  /* ── Search ── */
  .sidebar__search-wrap {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    position: sticky;
    top: 0;
    background: var(--bg-elevated);
    z-index: 1;
  }

  .sidebar__search {
    width: 100%;
    height: 30px;
    padding: 0 var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .sidebar__search::placeholder {
    color: var(--text-subtle);
  }

  .sidebar__search:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-color: var(--border);
  }

  /* ── Meta row ── */
  .sidebar__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .sidebar__meta-line {
    display: block;
    flex: 1;
    height: 1px;
    background: var(--border-subtle);
  }

  .sidebar__meta-pad {
    display: block;
    width: 3px;
    height: 3px;
    background: var(--accent);
    flex-shrink: 0;
  }

  .sidebar__meta-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  /* ── Nav ── */
  .sidebar__nav {
    flex: 1;
    padding: var(--space-2) 0;
  }

  /* ── Category ── */
  .sidebar__cat {
    margin-bottom: var(--space-1);
  }

  .sidebar__cat-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    text-align: left;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .sidebar__cat-head:hover {
    color: var(--text-primary);
  }

  .sidebar__cat-head:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .sidebar__chevron {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--text-subtle);
    transition: transform var(--duration-fast) var(--ease-sharp);
  }

  .sidebar__chevron--collapsed {
    transform: rotate(-90deg);
  }

  .sidebar__cat-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar__cat-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  /* ── Tool list ── */
  .sidebar__tool-list {
    list-style: none;
    padding: 0 0 var(--space-2) 0;
    margin: 0;
  }

  .sidebar__tool-item {
    position: relative;
  }

  .sidebar__active-marker {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 20px;
    background: var(--accent);
  }

  .sidebar__tool-link {
    display: block;
    padding: 5px var(--space-3) 5px calc(var(--space-3) + 16px);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition:
      color var(--duration-instant) var(--ease-sharp),
      background var(--duration-instant) var(--ease-sharp);
  }

  .sidebar__tool-link:hover {
    background: var(--bg-raised);
    color: var(--text-primary);
  }

  .sidebar__tool-link--active {
    background: var(--accent-dim);
    color: var(--accent);
    padding-left: calc(var(--space-3) + 16px - 3px);
  }

  .sidebar__tool-link--active:hover {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .sidebar__tool-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* ── Empty state ── */
  .sidebar__empty {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    padding: var(--space-4) var(--space-3);
  }

  /* ── Mobile (< 960px) ── */
  @media (max-width: 959px) {
    .sidebar-trigger {
      display: flex;
    }

    .sidebar-scrim {
      display: block;
    }

    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      height: 100vh;
      z-index: 50;
      width: 75vw;
      max-width: 320px;
      transform: translateX(-100%);
      transition: transform var(--duration-base) var(--ease-out);
    }

    .sidebar--open {
      transform: translateX(0);
    }
  }
</style>
