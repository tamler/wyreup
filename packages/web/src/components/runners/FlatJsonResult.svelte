<script lang="ts">
  export let json = '';

  type Primitive = string | number | boolean | null;
  type FlatEntry = [string, Primitive];

  const UNIT_LABELS = new Set([
    'bytes',
    'hours',
    'milliseconds',
    'minutes',
    'percent',
    'seconds',
  ]);

  let showRaw = false;
  let previousJson = '';

  function parseFlatEntries(value: string): FlatEntry[] | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;

      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return null;
      // Large flat objects (json-flatten output, big lookup tables) would
      // render one row per key; keep the readable view for small stat-like
      // results and fall back to the single-text-node raw view otherwise.
      if (entries.length > 40) return null;
      if (entries.some(([, entry]) => entry !== null && typeof entry === 'object')) return null;
      return entries as FlatEntry[];
    } catch {
      return null;
    }
  }

  function humanizeKey(key: string): string {
    const words = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase());

    const unit = words.at(-1);
    if (unit && UNIT_LABELS.has(unit) && words.length > 1) {
      const label = words.slice(0, -1).join(' ');
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} (${unit})`;
    }

    return words
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  }

  function formatValue(value: Primitive): string {
    if (typeof value === 'number') return value.toLocaleString();
    if (value === null) return '—';
    return String(value);
  }

  $: entries = parseFlatEntries(json);
  $: if (json !== previousJson) {
    previousJson = json;
    showRaw = false;
  }
</script>

{#if entries}
  <div class="flat-json-result">
    <div class="flat-json-result__toolbar">
      <button
        class="raw-toggle"
        class:raw-toggle--active={showRaw}
        type="button"
        aria-pressed={showRaw}
        on:click={() => { showRaw = !showRaw; }}
      >Raw JSON</button>
    </div>

    {#if showRaw}
      <pre class="json-viewer" role="region" aria-label="Raw JSON result">{json}</pre>
    {:else}
      <dl class="readable-json" aria-label="Result summary">
        {#each entries as [key, value]}
          <div class="readable-json__item">
            <dt>{humanizeKey(key)}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>
{:else}
  <pre class="json-viewer" role="region" aria-label="JSON result">{json}</pre>
{/if}

<style>
  .flat-json-result {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .flat-json-result__toolbar {
    display: flex;
    justify-content: flex-end;
  }

  .raw-toggle {
    min-height: 28px;
    padding: 0 var(--space-2);
    background: transparent;
    color: var(--text-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .raw-toggle:hover,
  .raw-toggle--active {
    background: var(--bg-raised);
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .raw-toggle:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .readable-json {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1px;
    margin: 0;
    overflow: hidden;
    background: var(--border-subtle);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .readable-json__item {
    min-width: 0;
    padding: var(--space-3);
    background: var(--bg);
  }

  .readable-json dt {
    margin: 0 0 var(--space-1);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .readable-json dd {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .json-viewer {
    max-height: 400px;
    margin: 0;
    overflow: auto;
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre;
  }
</style>
