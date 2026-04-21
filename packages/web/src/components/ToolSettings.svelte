<script lang="ts">
  import { onMount } from 'svelte';

  interface HeavyTool {
    id: string;
    name: string;
    description: string;
    installSize: number;
    slug: string;
  }

  export let heavyTools: HeavyTool[] = [];

  const PREFS_KEY = 'wyreup:tool-prefs';

  type CacheMode = 'all' | 'selected';

  interface ToolPrefs {
    cacheMode: CacheMode;
    enabled: Record<string, boolean>;
  }

  let prefs: ToolPrefs = { cacheMode: 'selected', enabled: {} };
  let cacheStatus: Record<string, 'cached' | 'not-cached' | 'checking'> = {};
  let clearConfirm = false;
  let cleared = false;

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        prefs = { cacheMode: parsed.cacheMode ?? 'selected', enabled: parsed.enabled ?? {} };
      } else {
        // Default: desktop gets 'all', narrow screen gets 'selected'
        const isMobile = window.matchMedia('(max-width: 640px)').matches;
        prefs = { cacheMode: isMobile ? 'selected' : 'all', enabled: {} };
      }
    } catch {
      prefs = { cacheMode: 'selected', enabled: {} };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      // Notify service worker of preference change
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'TOOL_PREFS_UPDATE',
          prefs,
        });
      }
    } catch {
      // ignore
    }
  }

  function setCacheMode(mode: CacheMode) {
    prefs = { ...prefs, cacheMode: mode };
    savePrefs();
  }

  function toggleTool(id: string) {
    const current = prefs.enabled[id] ?? false;
    prefs = { ...prefs, enabled: { ...prefs.enabled, [id]: !current } };
    savePrefs();
  }

  async function checkCacheStatus() {
    if (!('caches' in window)) return;
    for (const tool of heavyTools) {
      cacheStatus[tool.id] = 'checking';
    }
    cacheStatus = { ...cacheStatus };

    try {
      const cacheNames = await caches.keys();
      const allCaches = await Promise.all(cacheNames.map((n) => caches.open(n)));

      for (const tool of heavyTools) {
        // Heuristic: check if any cache has a response for a URL associated with this tool
        // In practice, these are CDN URLs — we can't easily enumerate them here.
        // So we report 'not-cached' unless the tool pref is enabled and cacheMode is 'all'.
        const isCached =
          prefs.cacheMode === 'all' || (prefs.cacheMode === 'selected' && (prefs.enabled[tool.id] ?? false));
        cacheStatus[tool.id] = isCached ? 'cached' : 'not-cached';
      }
    } catch {
      for (const tool of heavyTools) {
        cacheStatus[tool.id] = 'not-cached';
      }
    }
    cacheStatus = { ...cacheStatus };
  }

  async function clearAllCaches() {
    if (!clearConfirm) {
      clearConfirm = true;
      return;
    }
    clearConfirm = false;
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      cleared = true;
      setTimeout(() => { cleared = false; }, 3000);
      await checkCacheStatus();
    } catch {
      // ignore
    }
  }

  function formatSize(bytes: number): string {
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  onMount(() => {
    loadPrefs();
    checkCacheStatus();
  });
</script>

<div class="settings">
  <!-- Section 1: Cache mode -->
  <section class="settings-section">
    <h2 class="settings-section__title">Default behavior on this device</h2>
    <div class="radio-group">
      <label class="radio-row">
        <input
          type="radio"
          name="cache-mode"
          value="all"
          checked={prefs.cacheMode === 'all'}
          on:change={() => setCacheMode('all')}
        />
        <span class="radio-label">Cache all tools for offline use</span>
      </label>
      <label class="radio-row">
        <input
          type="radio"
          name="cache-mode"
          value="selected"
          checked={prefs.cacheMode === 'selected'}
          on:change={() => setCacheMode('selected')}
        />
        <span class="radio-label">Cache only tools I enable below</span>
      </label>
    </div>
  </section>

  <div class="settings-divider" aria-hidden="true">
    <span class="divider-line"></span>
    <span class="divider-pad"></span>
  </div>

  <!-- Section 2: Heavy tools -->
  <section class="settings-section">
    <h2 class="settings-section__title">Heavy tools</h2>
    <p class="settings-section__body">
      These tools download additional model files on first use. On mobile or metered connections, you can control which ones cache automatically.
    </p>

    <div class="tool-list">
      {#each heavyTools as tool}
        {@const enabled = prefs.cacheMode === 'all' || (prefs.enabled[tool.id] ?? false)}
        {@const status = cacheStatus[tool.id] ?? 'checking'}
        <div class="tool-row">
          <div class="tool-row__info">
            <div class="tool-row__name">
              <a href={`/tools/${tool.slug}`} class="tool-link">{tool.name}</a>
              <span class="tool-row__size">{formatSize(tool.installSize)}</span>
            </div>
            <p class="tool-row__desc">{tool.description}</p>
          </div>
          <div class="tool-row__controls">
            <span class="cache-status cache-status--{status}">{status === 'checking' ? '...' : status === 'cached' ? 'cached' : 'not cached'}</span>
            {#if prefs.cacheMode === 'selected'}
              <button
                class="toggle-btn"
                class:toggle-btn--on={prefs.enabled[tool.id] ?? false}
                on:click={() => toggleTool(tool.id)}
                aria-pressed={prefs.enabled[tool.id] ?? false}
              >
                {prefs.enabled[tool.id] ? 'Enabled' : 'Enable'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <div class="settings-divider" aria-hidden="true">
    <span class="divider-line"></span>
    <span class="divider-pad"></span>
  </div>

  <!-- Section 3: Clear cache -->
  <section class="settings-section">
    <h2 class="settings-section__title">Clear cache</h2>
    <p class="settings-section__body">
      Removes all cached files and models. The app will re-download what it needs on next use.
    </p>
    {#if cleared}
      <p class="clear-confirm-msg">Cache cleared.</p>
    {:else}
      <button
        class="btn btn-secondary clear-btn"
        on:click={clearAllCaches}
      >
        {clearConfirm ? 'Confirm — clear everything?' : 'Clear cache'}
      </button>
      {#if clearConfirm}
        <button class="btn-ghost cancel-btn" on:click={() => { clearConfirm = false; }}>Cancel</button>
      {/if}
    {/if}
  </section>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .settings-section__title {
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .settings-section__body {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    color: var(--text-muted);
    line-height: 1.6;
    max-width: 560px;
  }

  .settings-divider {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .divider-line {
    display: block;
    flex: 1;
    height: 1px;
    background: var(--border-subtle);
  }

  .divider-pad {
    display: block;
    width: 3px;
    height: 3px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* Radio */
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .radio-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    cursor: pointer;
  }

  .radio-row input[type="radio"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .radio-label {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    color: var(--text-primary);
  }

  /* Tool list */
  .tool-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .tool-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .tool-row:last-child {
    border-bottom: none;
  }

  .tool-row__info {
    flex: 1;
    min-width: 0;
  }

  .tool-row__name {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
    flex-wrap: wrap;
  }

  .tool-link {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    text-decoration: none;
  }

  .tool-link:hover {
    color: var(--accent);
  }

  .tool-row__size {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .tool-row__desc {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .tool-row__controls {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .cache-status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .cache-status--cached {
    color: var(--success);
  }

  .cache-status--not-cached {
    color: var(--text-subtle);
  }

  .cache-status--checking {
    color: var(--text-subtle);
  }

  .toggle-btn {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp),
                color var(--duration-instant) var(--ease-sharp);
  }

  .toggle-btn:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .toggle-btn--on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .toggle-btn--on:hover {
    border-color: var(--accent-hover);
    color: var(--accent-hover);
  }

  /* Clear cache */
  .clear-btn {
    align-self: flex-start;
  }

  .cancel-btn {
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    cursor: pointer;
    padding: var(--space-1) 0;
    margin-left: var(--space-3);
  }

  .cancel-btn:hover {
    color: var(--text-muted);
  }

  .clear-confirm-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--success);
  }

  @media (max-width: 640px) {
    .tool-row {
      flex-direction: column;
      gap: var(--space-3);
    }

    .tool-row__controls {
      flex-direction: row;
      align-items: center;
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
