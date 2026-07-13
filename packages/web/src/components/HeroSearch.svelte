<script lang="ts">
  import { onMount } from 'svelte';
  import { createToolSearch, searchTools } from '../lib/tool-search';
  import type { SearchResult, SearchableTool } from '../lib/tool-search';
  import { JOBS, type Job } from '../data/jobs';
  import { encodeChainSteps } from './runners/chainUrl';

  const dropdownId = 'hero-search-results';
  const examples = [
    { label: 'Compress a photo for email', href: '/tools/compress' },
    { label: 'Extract text from a scan', href: '/tools/ocr' },
    { label: 'Merge receipts into one PDF', href: '/tools/merge-pdf' },
    { label: 'Remove private info from a photo', href: '/tools/strip-exif' },
    { label: 'Clean up a voice recording', href: '/tools/audio-enhance' },
    { label: 'Convert HEIC to JPG', href: '/tools/convert' },
  ];

  let root: HTMLDivElement;
  let query = '';
  let jobResults: SearchResult[] = [];
  let results: SearchResult[] = [];
  let activeIndex = -1;
  let open = false;
  let loadingPromise: Promise<void> | null = null;
  let jobFuse: ReturnType<typeof createToolSearch> | null = null;
  let fuse: ReturnType<typeof createToolSearch> | null = null;
  const jobsBySlug = new Map(JOBS.map((job) => [job.slug, job]));

  $: activeOptionId = activeIndex >= 0 ? `hero-search-option-${activeIndex}` : undefined;
  $: resultCount = jobResults.length + results.length;

  function searchUrl(): string {
    return `/tools?q=${encodeURIComponent(query.trim())}`;
  }

  function jobUrl(job: Job): string {
    if (job.action.kind === 'tool') return `/tools/${job.action.toolId}`;
    return `/chain/run?steps=${encodeURIComponent(encodeChainSteps(job.action.steps))}`;
  }

  function jobUrlFromSlug(slug: string): string {
    const job = jobsBySlug.get(slug);
    return job ? jobUrl(job) : searchUrl();
  }

  function resultUrl(index: number): string {
    const jobResult = jobResults[index];
    if (jobResult) return jobUrlFromSlug(jobResult.tool.id);
    const toolResult = results[index - jobResults.length];
    return toolResult ? `/tools/${toolResult.tool.id}` : searchUrl();
  }

  function updateResults(): void {
    const trimmed = query.trim();
    activeIndex = -1;
    if (!fuse || !jobFuse || !trimmed) {
      jobResults = [];
      results = [];
      open = false;
      return;
    }

    jobResults = searchTools(jobFuse, trimmed, 3);
    results = searchTools(fuse, trimmed, 6);
    open = true;
  }

  function loadIndex(): Promise<void> {
    if (fuse) return Promise.resolve();
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        const response = await fetch('/tools-index.json');
        if (!response.ok) return;
        const tools: SearchableTool[] = await response.json();
        fuse = createToolSearch(tools);
        jobFuse = createToolSearch(
          JOBS.map((job) => ({
            id: job.slug,
            name: job.title,
            description: job.description,
            category: 'job',
            keywords: [],
          })),
        );
        updateResults();
      } catch {
        open = false;
      }
    })();

    return loadingPromise;
  }

  function handleFocus(): void {
    void loadIndex();
    if (fuse && query.trim()) updateResults();
  }

  function handleInput(): void {
    updateResults();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      activeIndex = -1;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < resultCount) {
        window.location.assign(resultUrl(activeIndex));
      } else {
        window.location.assign(searchUrl());
      }
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && resultCount > 0) {
      event.preventDefault();
      open = true;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (activeIndex < 0) {
        activeIndex = direction > 0 ? 0 : resultCount - 1;
      } else {
        activeIndex = (activeIndex + direction + resultCount) % resultCount;
      }
    }
  }

  function handleFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !root.contains(next)) {
      open = false;
      activeIndex = -1;
    }
  }

  onMount(() => {
    function handleOutsidePointer(event: PointerEvent): void {
      if (!(event.target instanceof Node) || !root.contains(event.target)) {
        open = false;
        activeIndex = -1;
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  });
</script>

<div class="hero-search" bind:this={root} on:focusout={handleFocusOut}>
  <div class="hero-search__combobox">
    <span class="hero-search__icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </span>
    <input
      type="search"
      bind:value={query}
      placeholder={'Describe what you need — try "compress photos for email"'}
      aria-label="Describe what you need"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={dropdownId}
      aria-activedescendant={activeOptionId}
      autocomplete="off"
      on:focus={handleFocus}
      on:input={handleInput}
      on:keydown={handleKeydown}
    />

    {#if open}
      <div id={dropdownId} class="hero-search__dropdown" role="listbox" aria-label="Job and tool suggestions">
        {#if resultCount > 0}
          {#each jobResults as result, i}
            <a
              id={`hero-search-option-${i}`}
              class:active={i === activeIndex}
              class="hero-search__result"
              href={jobUrlFromSlug(result.tool.id)}
              role="option"
              aria-selected={i === activeIndex}
              on:mouseenter={() => (activeIndex = i)}
            >
              <span class="hero-search__result-copy">
                <span class="hero-search__result-name">{result.tool.name}</span>
                <span class="hero-search__result-description">{result.tool.description}</span>
              </span>
              <span class="hero-search__category">job</span>
            </a>
          {/each}
          {#each results as result, i}
            <a
              id={`hero-search-option-${jobResults.length + i}`}
              class:active={jobResults.length + i === activeIndex}
              class="hero-search__result"
              href={`/tools/${result.tool.id}`}
              role="option"
              aria-selected={jobResults.length + i === activeIndex}
              on:mouseenter={() => (activeIndex = jobResults.length + i)}
            >
              <span class="hero-search__result-copy">
                <span class="hero-search__result-name">{result.tool.name}</span>
                <span class="hero-search__result-description">{result.tool.description}</span>
              </span>
              <span class="hero-search__category">{result.tool.category}</span>
            </a>
          {/each}
        {:else}
          <div class="hero-search__empty">
            No matches — <a href={searchUrl()}>browse all tools</a>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="hero-search__examples" aria-label="Example file jobs">
    {#each examples as example}
      <a href={example.href} class="hero-search__chip">{example.label}</a>
    {/each}
  </div>
</div>

<style>
  .hero-search {
    width: 100%;
    max-width: 40rem;
    margin-bottom: var(--space-6);
  }

  .hero-search__combobox {
    position: relative;
  }

  .hero-search__icon {
    position: absolute;
    z-index: 1;
    left: var(--space-4);
    top: 50%;
    display: flex;
    color: var(--text-subtle);
    transform: translateY(-50%);
    pointer-events: none;
  }

  input {
    width: 100%;
    height: 48px;
    padding: 0 var(--space-4) 0 44px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-base);
  }

  input::placeholder {
    color: var(--text-subtle);
    opacity: 1;
  }

  input:focus {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .hero-search__dropdown {
    position: absolute;
    z-index: 30;
    top: calc(100% + var(--space-2));
    left: 0;
    right: 0;
    max-height: 392px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  }

  .hero-search__result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid var(--border-subtle);
  }

  .hero-search__result:last-child {
    border-bottom: 0;
  }

  .hero-search__result:hover,
  .hero-search__result.active {
    background: var(--accent-dim);
  }

  .hero-search__result:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .hero-search__result-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .hero-search__result-name {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .hero-search__result-description {
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hero-search__category {
    flex-shrink: 0;
    padding: 2px var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .hero-search__empty {
    padding: var(--space-4);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .hero-search__empty a {
    color: var(--accent-text);
    text-underline-offset: 2px;
  }

  .hero-search__examples {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .hero-search__chip {
    padding: var(--space-1) var(--space-2);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1.4;
    text-decoration: none;
    transition:
      color var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .hero-search__chip:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .hero-search__chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 640px) {
    input {
      height: 44px;
      font-size: var(--text-sm);
    }

    .hero-search__result-description {
      max-width: 16rem;
    }
  }
</style>
