<script lang="ts">
  import { onMount } from 'svelte';

  type HeavyEntry =
    | {
        type: 'tool';
        id: string;
        name: string;
        description: string;
        installSize: number;
        slug: string;
      }
    | {
        type: 'group';
        id: string;
        name: string;
        description: string;
        installSize: number;
        toolIds: string[];
      };

  export let heavyTools: HeavyEntry[] = [];

  const PREFS_KEY = 'wyreup:tool-prefs';

  type CacheMode = 'all' | 'selected';

  interface ToolPrefs {
    cacheMode: CacheMode;
    enabled: Record<string, boolean>;
  }

  let prefs: ToolPrefs = { cacheMode: 'selected', enabled: {} };

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

  function formatSize(bytes: number): string {
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  onMount(() => {
    loadPrefs();
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
      {#each heavyTools as entry}
        {@const enabled = prefs.cacheMode === 'all' || (prefs.enabled[entry.id] ?? false)}
        <div class="tool-row">
          <div class="tool-row__info">
            <div class="tool-row__name">
              {#if entry.type === 'tool'}
                <a href={`/tools/${entry.slug}`} class="tool-link">{entry.name}</a>
              {:else}
                <span class="tool-group-name">{entry.name}</span>
              {/if}
              <span class="tool-row__size">{formatSize(entry.installSize)}</span>
            </div>
            <p class="tool-row__desc">{entry.description}</p>
          </div>
          <div class="tool-row__controls">
            <span class="cache-status cache-status--{enabled ? 'enabled' : 'disabled'}">
              {enabled ? 'enabled' : 'disabled'}
            </span>
            {#if prefs.cacheMode === 'selected'}
              <button
                class="toggle-btn"
                class:toggle-btn--on={prefs.enabled[entry.id] ?? false}
                on:click={() => toggleTool(entry.id)}
                aria-pressed={prefs.enabled[entry.id] ?? false}
              >
                {prefs.enabled[entry.id] ? 'Disable' : 'Enable'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <p class="settings-section__footnote">
      "Enabled" means this tool's model will be cached when you use it.
      Actual cache contents and total disk usage are shown in the Storage
      panel above; clear them there.
    </p>
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
    color: var(--accent-text);
  }

  .tool-group-name {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
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

  .cache-status--enabled {
    color: var(--accent-text);
  }

  .cache-status--disabled {
    color: var(--text-subtle);
  }

  .settings-section__footnote {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    line-height: 1.5;
    margin: var(--space-3) 0 0;
    padding-left: var(--space-3);
    border-left: 1px solid var(--border-subtle);
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
    border-color: var(--accent-hover);
    color: var(--accent-text);
  }

  .toggle-btn--on:hover {
    border-color: var(--accent-hover);
    color: var(--accent-hover);
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
