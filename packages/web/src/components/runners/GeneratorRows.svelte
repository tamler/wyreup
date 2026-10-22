<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { decodeGeneratorRows, encodeGeneratorRows, exportGeneratorRows, importGeneratorRows, newGeneratorRow, GENERATOR_PAGE_SIZE, type GeneratorRow, type GeneratorRowContract } from './generatorRows';
  export let contract: GeneratorRowContract;
  export let value: unknown;
  const dispatch = createEventDispatcher<{ change: { key: string; value: string | null; valid: boolean } }>();
  let rows: GeneratorRow[] = [];
  let error = '';
  let paste = '';
  let pendingPaste = false;
  let delimiter: 'comma' | 'tab' = 'comma';
  let page = 0;
  let seen: unknown = Symbol();
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  $: if (value !== seen) {
    seen = value;
    try { rows = decodeGeneratorRows(value, contract); error = ''; }
    catch (cause) { rows = []; error = cause instanceof Error ? cause.message : 'Invalid rows.'; }
    page = 0;
  }
  $: pageCount = Math.max(1, Math.ceil(rows.length / GENERATOR_PAGE_SIZE));
  $: visible = rows.slice(page * GENERATOR_PAGE_SIZE, (page + 1) * GENERATOR_PAGE_SIZE);
  function notify() {
    try {
      const encoded = encodeGeneratorRows(rows, contract);
      error = '';
      if (!pendingPaste) seen = encoded;
      dispatch('change', { key: contract.key, value: encoded, valid: !pendingPaste });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Invalid rows.';
      dispatch('change', { key: contract.key, value: null, valid: false });
    }
  }
  function edit(index: number, key: string, text: string, numeric: boolean) {
    rows = rows.map((row, at) => at === index ? { ...row, [key]: numeric ? (/^(301|302|307|308)$/.test(text) ? Number(text) : null) : text } : row);
    notify();
  }
  function add() { if (rows.length >= contract.maxRows) return; rows = [...rows, newGeneratorRow(contract)]; page = Math.floor((rows.length - 1) / GENERATOR_PAGE_SIZE); notify(); }
  function remove(index: number) { rows = rows.filter((_row, at) => at !== index); page = Math.min(page, Math.max(0, Math.ceil(rows.length / GENERATOR_PAGE_SIZE) - 1)); notify(); }
  function pasteChanged() { pendingPaste = paste.length > 0; if (pendingPaste) dispatch('change', { key: contract.key, value: null, valid: false }); else notify(); }
  function discardPaste() { paste = ''; pendingPaste = false; notify(); }
  function importRows() {
    try { const imported = importGeneratorRows(paste, delimiter, contract); rows = imported; page = 0; paste = ''; pendingPaste = false; notify(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Import failed.'; dispatch('change', { key: contract.key, value: null, valid: false }); }
  }
  function exportRows() {
    try {
      const text = exportGeneratorRows(rows, delimiter, contract);
      const url = URL.createObjectURL(new Blob([text], { type: delimiter === 'comma' ? 'text/csv' : 'text/tab-separated-values' }));
      const link = document.createElement('a'); link.href = url; link.download = `${contract.toolId}-${contract.key}.${delimiter === 'comma' ? 'csv' : 'tsv'}`; link.click();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); downloads.set(url, timer);
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Export failed.'; }
  }
  onMount(notify);
  onDestroy(() => { for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } downloads.clear(); });
</script>

<section aria-label={contract.label} class="rows">
  <h3>{contract.label}</h3>
  <p>{rows.length} rows; maximum {contract.maxRows}. Page {page + 1} of {pageCount}. All rows are included when generated.</p>
  {#each visible as row, offset}
    {@const index = page * GENERATOR_PAGE_SIZE + offset}
    <fieldset aria-describedby={error ? `generator-${contract.key}-error` : undefined}><legend>{contract.label} row {index + 1}</legend>
      {#each contract.columns as column}
        <label>{column.label} {index + 1}
          {#if column.options}
            <select value={String(row[column.key] ?? '')} aria-label={`${column.label} ${index + 1}`} aria-invalid={!!error} aria-describedby={error ? `generator-${contract.key}-error` : undefined} on:change={(event) => edit(index, column.key, event.currentTarget.value, !!column.numeric)}>
              {#each column.options as option}<option value={option}>{option}</option>{/each}
            </select>
          {:else}
            <input type="text" value={String(row[column.key] ?? '')} maxlength={column.maxLength} spellcheck="false" aria-invalid={!!error} aria-describedby={error ? `generator-${contract.key}-error` : undefined} on:input={(event) => edit(index, column.key, event.currentTarget.value, false)} />
          {/if}
        </label>
      {/each}
      <button type="button" on:click={() => remove(index)}>Remove {contract.label} row {index + 1}</button>
    </fieldset>
  {/each}
  <div class="actions"><button type="button" disabled={rows.length >= contract.maxRows} on:click={add}>Add {contract.label} row</button><button type="button" disabled={page === 0} on:click={() => page--}>Previous {contract.label} page</button><button type="button" disabled={page + 1 >= pageCount} on:click={() => page++}>Next {contract.label} page</button><button type="button" on:click={() => { rows = []; page = 0; discardPaste(); }}>Clear {contract.label} rows</button></div>
  <details><summary>Import or export {contract.label}</summary>
    <p>Paste CSV or TSV with exactly these named headers: <code>{contract.columns.map(({ key }) => key).join(', ')}</code>. Import replaces this section after validation. Quoted cells retain their literal content.</p>
    <label>{contract.label} delimiter<select aria-label={`${contract.label} delimiter`} bind:value={delimiter} on:change={pasteChanged}><option value="comma">CSV (comma)</option><option value="tab">TSV (tab)</option></select></label>
    <label>Paste {contract.label}<textarea bind:value={paste} maxlength="100000" rows="6" spellcheck="false" on:input={pasteChanged}></textarea></label>
    <div class="actions"><button type="button" disabled={!paste} on:click={importRows}>Import {contract.label}</button><button type="button" on:click={discardPaste}>Discard {contract.label} paste</button><button type="button" on:click={exportRows}>Export {contract.label} rows</button></div>
    <p>Row exports preserve input strings. Treat them as configuration data; spreadsheet applications may interpret cell text as formulas.</p>
  </details>
  {#if pendingPaste}<p role="status">Import or discard the pasted draft before generating.</p>{/if}
  {#if error}<p id={`generator-${contract.key}-error`} role="alert">{contract.label}: {error}</p>{/if}
</section>

<style>
  .rows, fieldset, details { display: grid; gap: var(--space-2); min-width: 0; }
  fieldset { margin: 0; border: 1px solid var(--border); padding: var(--space-3); }
  label { display: grid; gap: var(--space-1); }
  input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; font: inherit; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  button { font: inherit; cursor: pointer; padding: var(--space-2); color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  button:disabled { opacity: 0.6; cursor: default; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  code { overflow-wrap: anywhere; }
</style>
