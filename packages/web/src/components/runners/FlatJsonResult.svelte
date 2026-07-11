<script lang="ts">
  import {
    classifyJsonValue,
    formatValue,
    humanizeKey,
    type JsonView,
    type Primitive,
  } from './jsonView';

  export let json = '';

  let showRaw = false;
  let previousJson = '';

  function parseJsonView(value: string): JsonView | null {
    try {
      return classifyJsonValue(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  function formatValues(values: Primitive[]): string {
    return values.map(formatValue).join(', ');
  }

  function formatCell(row: Record<string, Primitive>, column: string): string {
    return column in row ? formatValue(row[column]!) : '—';
  }

  $: view = parseJsonView(json);
  $: if (json !== previousJson) {
    previousJson = json;
    showRaw = false;
  }
</script>

{#if view}
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
    {:else if view.kind === 'flat'}
      <dl class="readable-json" aria-label="Result summary">
        {#each view.entries as [key, value]}
          <div class="readable-json__item">
            <dt>{humanizeKey(key)}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        {/each}
      </dl>
    {:else if view.kind === 'table'}
      <div class="table-scroll" role="region" aria-label="Result table" tabindex="0">
        <table>
          <thead>
            <tr>
              {#each view.columns as column}
                <th scope="col">{humanizeKey(column)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each view.rows as row}
              <tr>
                {#each view.columns as column}
                  <td>{formatCell(row, column)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      {@const primitives = view.sections.filter((section) => section.kind === 'primitive')}
      <div class="json-sections">
        {#if primitives.length > 0}
          <dl class="readable-json" aria-label="Result summary">
            {#each primitives as section}
              <div class="readable-json__item">
                <dt>{humanizeKey(section.key)}</dt>
                <dd>{formatValue(section.value)}</dd>
              </div>
            {/each}
          </dl>
        {/if}

        {#each view.sections as section}
          {#if section.kind === 'primitive-array'}
            <section class="json-section">
              <h3>{humanizeKey(section.key)}</h3>
              <p>{formatValues(section.values)}</p>
            </section>
          {:else if section.kind === 'flat'}
            <section class="json-section">
              <h3>{humanizeKey(section.key)}</h3>
              <dl class="readable-json readable-json--subgrid">
                {#each section.entries as [key, value]}
                  <div class="readable-json__item">
                    <dt>{humanizeKey(key)}</dt>
                    <dd>{formatValue(value)}</dd>
                  </div>
                {/each}
              </dl>
            </section>
          {:else if section.kind === 'group'}
            <section class="json-section">
              <h3>{humanizeKey(section.key)}</h3>
              <dl class="readable-json readable-json--subgrid">
                {#each section.entries as [key, value]}
                  <div class="readable-json__item">
                    <dt>{humanizeKey(key)}</dt>
                    <dd>{Array.isArray(value) ? formatValues(value) : formatValue(value)}</dd>
                  </div>
                {/each}
              </dl>
            </section>
          {:else if section.kind === 'table'}
            <section class="json-section">
              <h3>{humanizeKey(section.key)}</h3>
              <div
                class="table-scroll"
                role="region"
                aria-label={`${humanizeKey(section.key)} table`}
                tabindex="0"
              >
                <table>
                  <thead>
                    <tr>
                      {#each section.table.columns as column}
                        <th scope="col">{humanizeKey(column)}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each section.table.rows as row}
                      <tr>
                        {#each section.table.columns as column}
                          <td>{formatCell(row, column)}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </section>
          {/if}
        {/each}
      </div>
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

  .json-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .json-section {
    min-width: 0;
  }

  .json-section h3 {
    margin: 0 0 var(--space-2);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.4;
  }

  .json-section p {
    margin: 0;
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .readable-json--subgrid dd {
    font-size: var(--text-base);
  }

  .table-scroll {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .table-scroll:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  th,
  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    text-align: left;
    vertical-align: top;
    white-space: nowrap;
  }

  th {
    background: var(--bg-raised);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  td {
    font-variant-numeric: tabular-nums;
  }

  tbody tr:last-child td {
    border-bottom: 0;
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
