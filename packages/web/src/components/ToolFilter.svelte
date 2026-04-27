<script lang="ts">
  import { onMount } from 'svelte';
  import { createToolSearch } from '../lib/tool-search';
  import { stashChainFile } from './runners/chainStorage';
  import { capabilities, showUnrunnable, filterRunnable } from '../stores/capabilities';
  import type { ToolRequires } from '@wyreup/core';

  const SUGGEST_URL_BASE =
    'https://github.com/tamler/wyreup/issues/new?template=tool-suggestion.yml&title=Tool+suggestion%3A+';

  interface Tool {
    id: string;
    name: string;
    category: string;
    description: string;
    keywords: string[];
    requiresWebgpu?: 'preferred' | 'required';
    requires?: ToolRequires;
    accept: string[];
  }

  export let tools: Tool[] = [];
  export let categories: string[] = [];

  // Hide tools the device can't run unless the user opts to show all.
  // Direct URLs (`/tools/<id>`) still resolve so chains don't break.
  $: visibleTools = (() => {
    const { runnable, hiddenCount } = filterRunnable(tools, $capabilities.caps, $showUnrunnable);
    return { list: runnable, hiddenCount, ready: $capabilities.ready };
  })();

  // ── State ──────────────────────────────────────────────────────────────────

  // Inline SVG icons per category (Lucide-style: 20px, 1.5px stroke) — card icons
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
    finance: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="14.5" y2="14.5"/><path d="M12 6v2M12 16v2M8 12H6M18 12h-2"/></svg>`,
    audio: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    media: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    archive: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  };
  const defaultIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;

  // 14px chip icons — same SVG paths, smaller size
  const chipIcons: Record<string, string> = {
    optimize: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
    convert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>`,
    pdf: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    inspect: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    create: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    privacy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    extract: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    generate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>`,
    text: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    dev: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    image: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    export: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    finance: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="14.5" y2="14.5"/><path d="M12 6v2M12 16v2M8 12H6M18 12h-2"/></svg>`,
    audio: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    media: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    archive: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  };
  const defaultChipIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;

  // ── Drop-to-filter (mirrors the homepage hero drop zone behaviour) ────────
  // A user drops a file at the top of /tools and the grid narrows to tools
  // compatible with that file's MIME. Stacks with category chips + header
  // search. Local to this page — no cross-route store leakage.

  function mimeMatches(toolMimes: string[], filterMimes: string[]): boolean {
    for (const filter of filterMimes) {
      const filterPrefix = filter.endsWith('/*') ? filter.slice(0, -2) : null;
      for (const toolMime of toolMimes) {
        if (filterPrefix) {
          if (toolMime.startsWith(filterPrefix + '/') || toolMime === filter) return true;
        } else {
          if (toolMime === filter) return true;
        }
      }
    }
    return false;
  }

  // Keep the actual File so tool-card clicks can hand it off via sessionStorage.
  let droppedFile: { name: string; mime: string; file: File } | null = null;
  let isDragOver = false;

  function handleDropZoneDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDropZoneDragLeave() {
    isDragOver = false;
  }

  function handleDropZoneDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    droppedFile = { name: file.name, mime: file.type || 'application/octet-stream', file };
    applyFilter();
  }

  function handleDropZonePick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      droppedFile = { name: file.name, mime: file.type || 'application/octet-stream', file };
      applyFilter();
    };
    input.click();
  }

  function clearDroppedFile() {
    droppedFile = null;
    applyFilter();
  }

  // When a tool is clicked while a file is dropped, stash the file so the
  // tool page picks it up automatically — no re-upload required. Only intercept
  // plain left-clicks so cmd/ctrl/middle-click "open in new tab" still works.
  async function handleToolCardClick(e: MouseEvent, toolId: string) {
    if (!droppedFile) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    await stashChainFile(droppedFile.file, { autoAccept: true });
    window.location.href = `/tools/${toolId}`;
  }

  // Counts per category from the device-runnable subset.
  $: categoryCounts = categories.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = visibleTools.list.filter((t) => t.category === cat).length;
    return acc;
  }, {});

  // query is set from URL ?q= on mount; not editable inline (header search handles that)
  let query = '';
  let activeCategories: Set<string> = new Set();
  let filtered: Tool[] = tools;
  // Incremented on each filter change to re-trigger stagger animation
  let filterEpoch = 0;

  $: suggestUrl = query.trim()
    ? SUGGEST_URL_BASE + encodeURIComponent(query.trim())
    : SUGGEST_URL_BASE;

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
    const q = query.trim();
    // Filter-by-dropped-file: treat the dropped MIME as the constraint.
    const droppedMimeFilter = droppedFile ? [droppedFile.mime] : null;
    const pool = visibleTools.list;

    if (q) {
      const fuse = createToolSearch(pool.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        keywords: t.keywords ?? [],
      })));
      const results = fuse.search(q).map((r) => r.item);
      const catFiltered = activeCategories.size === 0
        ? results
        : results.filter((r) => activeCategories.has(r.category));
      const byId = new Map(pool.map((t) => [t.id, t]));
      const lookupFiltered = catFiltered.map((r) => byId.get(r.id)!).filter(Boolean);
      filtered = droppedMimeFilter
        ? lookupFiltered.filter((t) => mimeMatches(t.accept, droppedMimeFilter))
        : lookupFiltered;
    } else {
      const catFiltered = activeCategories.size === 0
        ? pool
        : pool.filter((t) => activeCategories.has(t.category));
      filtered = droppedMimeFilter
        ? catFiltered.filter((t) => mimeMatches(t.accept, droppedMimeFilter))
        : catFiltered;
    }
    filterEpoch += 1;
  }

  function clearAll() {
    query = '';
    activeCategories = new Set();
    droppedFile = null;
    applyFilter();
  }

  $: {
    activeCategories;
    visibleTools;
    applyFilter();
  }

  // ── Recently used (localStorage) ─────────────────────────────────────────
  const RECENT_KEY = 'wyreup:recent-tools';
  const MAX_RECENT = 10;

  interface RecentEntry {
    id: string;
    name: string;
    ts: number;
  }

  let recentTools: RecentEntry[] = [];

  function loadRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return;
      const parsed: RecentEntry[] = JSON.parse(raw);
      // Filter to only tools that still exist
      const validIds = new Set(tools.map((t) => t.id));
      recentTools = parsed.filter((r) => validIds.has(r.id));
    } catch {
      recentTools = [];
    }
  }

  function clearRecent() {
    localStorage.removeItem(RECENT_KEY);
    recentTools = [];
  }

  onMount(() => {
    // Pre-fill query from URL ?q= param (header search navigation)
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      query = q;
      applyFilter();
    }

    loadRecent();
  });
</script>

<!-- Recently used strip (Deliverable 6) -->
{#if recentTools.length > 0}
  <div class="recent-strip" aria-label="Recently used tools">
    <span class="recent-label">Recently used</span>
    <div class="recent-pills">
      {#each recentTools as r (r.id)}
        <a class="recent-pill" href={`/tools/${r.id}`}>{r.name}</a>
      {/each}
    </div>
    <button class="recent-clear" on:click={clearRecent}>Clear</button>
  </div>
{/if}

<!-- Inline drop zone — filter the grid by a dropped file's MIME -->
{#if droppedFile}
  <div class="drop-filter drop-filter--active" role="status">
    <div class="drop-filter__inner">
      <span class="drop-filter__label">
        Showing tools compatible with
        <span class="drop-filter__name">{droppedFile.name}</span>
        <span class="drop-filter__mime">({droppedFile.mime.split('/').pop() ?? droppedFile.mime})</span>
      </span>
      <button class="drop-filter__clear" on:click={clearDroppedFile} aria-label="Clear dropped file filter">
        Drop another · clear
      </button>
    </div>
  </div>
{:else}
  <button
    type="button"
    class="drop-filter drop-filter--empty"
    class:drop-filter--hover={isDragOver}
    on:click={handleDropZonePick}
    on:dragover={handleDropZoneDragOver}
    on:dragleave={handleDropZoneDragLeave}
    on:drop={handleDropZoneDrop}
    aria-label="Drop a file to filter tools by what can handle it"
  >
    <span class="drop-filter__inner">
      <span class="drop-filter__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </span>
      <span class="drop-filter__label">
        Drop a file here to see tools that can handle it.
      </span>
    </span>
  </button>
{/if}

<!-- Category chip filter -->
<div class="filter-bar">
  <div class="filter-chips" role="group" aria-label="Filter by category">
    {#each categories as cat}
      <button
        class="filter-chip"
        class:active={activeCategories.has(cat)}
        on:click={() => toggleCategory(cat)}
        aria-pressed={activeCategories.has(cat)}
      >
        <span class="filter-chip__icon">{@html chipIcons[cat] ?? defaultChipIcon}</span>
        <span class="filter-chip__label">{cat}</span>
        <span class="filter-chip__count">({categoryCounts[cat] ?? 0})</span>
      </button>
    {/each}
  </div>
</div>

<div class="results-meta">
  <span class="results-count">{filtered.length} tool{filtered.length !== 1 ? 's' : ''}</span>
  {#if visibleTools.ready && visibleTools.hiddenCount > 0}
    <span class="results-hidden">
      {visibleTools.hiddenCount} hidden — your device can't run them.
      <button class="results-show-all" on:click={() => showUnrunnable.set(!$showUnrunnable)} type="button">
        {$showUnrunnable ? 'Hide them again' : 'Show all'}
      </button>
    </span>
  {/if}
  {#if activeCategories.size > 0 || droppedFile !== null}
    <button class="clear-btn" on:click={clearAll}>Clear</button>
  {/if}
</div>

{#if filtered.length === 0}
  <div class="empty-state" role="status">
    <span class="empty-icon" aria-hidden="true">{@html `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`}</span>
    <p class="empty-msg">No tools match {query ? `"${query}"` : 'this filter'}.</p>
    <button class="btn-ghost" on:click={clearAll}>Clear filter</button>
    {#if query.trim()}
      <a
        class="btn-suggest"
        href={suggestUrl}
        target="_blank"
        rel="noopener noreferrer"
      >Suggest a tool</a>
    {/if}
  </div>
{:else}
  <div class="tool-grid" role="list">
    {#each filtered as tool, i (`${filterEpoch}-${tool.id}`)}
      <a
        href={`/tools/${tool.id}`}
        class="tool-card brackets"
        role="listitem"
        aria-label="{tool.name} — {tool.category}"
        style="--stagger-delay: {i * 50}ms"
        on:click={(e) => handleToolCardClick(e, tool.id)}
      >
        <div class="brackets-inner" aria-hidden="true"></div>
        <div class="tool-card__inner">
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
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  /* Inline drop-to-filter zone (same pattern as homepage HeroDrop). */
  .drop-filter {
    display: block;
    width: 100%;
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      background var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .drop-filter--empty:hover,
  .drop-filter--hover {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--bg-raised);
  }

  .drop-filter--active {
    cursor: default;
    border-style: solid;
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--text-primary);
  }

  .drop-filter__inner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .drop-filter__icon {
    color: var(--accent);
    flex-shrink: 0;
  }

  .drop-filter__label {
    flex: 1;
    min-width: 0;
  }

  .drop-filter__name {
    font-family: var(--font-mono);
    color: var(--accent);
    font-weight: 500;
  }

  .drop-filter__mime {
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-size: var(--text-xs);
    margin-left: var(--space-1);
  }

  .drop-filter__clear {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    transition: color var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }

  .drop-filter__clear:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .drop-filter__clear:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Recently used strip */
  .recent-strip {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .recent-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .recent-pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    flex: 1;
  }

  .recent-pill {
    height: 24px;
    padding: 0 var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .recent-pill:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .recent-pill:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .recent-clear {
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .recent-clear:hover {
    color: var(--text-muted);
  }

  .recent-clear:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* Filter bar */
  .filter-bar {
    margin-bottom: var(--space-4);
  }

  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-chip {
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp),
      background var(--duration-instant) var(--ease-sharp);
  }

  .filter-chip__icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .filter-chip__count {
    color: var(--text-subtle);
    font-size: var(--text-xs);
  }

  .filter-chip:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .filter-chip:hover .filter-chip__count {
    color: var(--text-muted);
  }

  .filter-chip.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-dim);
  }

  .filter-chip.active .filter-chip__count {
    color: var(--accent);
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
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .clear-btn:hover {
    color: var(--text-muted);
  }

  .results-hidden {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin-left: auto;
  }

  .results-show-all {
    background: none;
    border: none;
    padding: 0;
    margin-left: var(--space-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .results-show-all:hover {
    color: var(--text-primary);
  }

  .results-show-all:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
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

  /* Tool card — double-bezel: outer frame + inner raised surface */
  .tool-card {
    display: block;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    text-decoration: none;
    color: inherit;
    transition: border-color var(--duration-fast) var(--ease-sharp);
    position: relative;
    overflow: visible;
    /* staggered reveal */
    opacity: 0;
    transform: translateY(8px);
    animation: card-reveal 200ms cubic-bezier(0, 0, 0.2, 1) forwards;
    animation-delay: var(--stagger-delay, 0ms);
  }

  @keyframes card-reveal {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .tool-card:hover {
    border-color: var(--text-muted);
  }

  .tool-card:hover .tool-card__icon {
    color: var(--accent);
  }

  .tool-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .tool-card__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-4);
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
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .btn-suggest {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-decoration: none;
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .btn-suggest:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .btn-suggest:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
