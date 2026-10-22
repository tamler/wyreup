<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { decodeFinanceRows, encodeFinanceRows, newFinanceRow, parseFinanceRowsCsv, type FinanceRow, type FinanceRowContract } from './financeRows';
  export let fieldKey: string;
  export let label: string;
  export let value: unknown;
  export let contract: FinanceRowContract;
  const dispatch = createEventDispatcher<{ change: { key: string; value: string | null; valid: boolean } }>();
  let items: FinanceRow[] = [];
  let error = '';
  let paste = '';
  let delimiter: 'comma' | 'tab' | 'semicolon' | 'pipe' = 'comma';
  let page = 0;
  const pageSize = 20;
  let previewReady = false;
  let seen: unknown = Symbol('uninitialized');
  $: if (value !== seen) {
    seen = value;
    try { items = decodeFinanceRows(value, contract); error = ''; }
    catch (cause) { items = []; error = cause instanceof Error ? cause.message : 'Check the rows.'; }
    page = 0;
  }
  $: pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  $: page = Math.min(page, pageCount - 1);
  function notify() {
    try { const encoded = encodeFinanceRows(items, contract); error = ''; seen = encoded; dispatch('change', { key: fieldKey, value: encoded, valid: true }); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Check the rows.'; dispatch('change', { key: fieldKey, value: null, valid: false }); }
  }
  onMount(notify);
  function update(index: number, key: string, event: Event, numeric: boolean) {
    const input = event.currentTarget as HTMLInputElement;
    const cell = numeric ? input.value.trim() === '' || input.validity.badInput ? null : Number(input.value) : input.value;
    items = items.map((row, i) => i === index ? { ...row, [key]: cell } : row);
    previewReady = false; notify();
  }
  function include(index: number, key: string, checked: boolean) {
    items = items.map((row, i) => { if (i !== index) return row; const next = { ...row }; if (checked) next[key] = null; else delete next[key]; return next; });
    previewReady = false; notify();
  }
  function addRow() { items = [...items, newFinanceRow(contract)]; page = Math.floor((items.length - 1) / pageSize); previewReady = false; notify(); }
  function remove(index: number) { items = items.filter((_, i) => i !== index); previewReady = false; notify(); }
  function preview() {
    try { items = parseFinanceRowsCsv(paste, delimiter, contract); page = 0; previewReady = true; notify(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Check pasted rows.'; previewReady = false; dispatch('change', { key: fieldKey, value: null, valid: false }); }
  }
  function changedPaste(event: Event) { paste = (event.currentTarget as HTMLTextAreaElement).value; previewReady = false; error = 'Preview pasted rows before calculating.'; dispatch('change', { key: fieldKey, value: null, valid: false }); }
</script>

<fieldset class="finance-rows">
  <legend>{label}</legend>
  <p>Money columns use your selected currency. Rates are your assumptions. Required numeric cells start blank.</p>
  <p>CSV/TSV headers: {contract.columns.map((column) => `${column.key}${column.optional ? ' (optional)' : ''}`).join(', ')}. Numeric cells use plain decimals; no currency symbols, thousands separators, exponents or blank-as-zero.</p>
  {#if contract.bands}<p>Exactly one final row must cover the remaining amount. Use the labeled row controls and its “Remaining amount” checkbox for band schedules. CSV numeric cells cannot express an open upper bound.</p>{/if}
  <div class="paste-controls">
    <label for={`finance-${fieldKey}-paste`}>Paste {label} as CSV or TSV</label>
    <textarea id={`finance-${fieldKey}-paste`} rows="4" value={paste} maxlength="100000" on:input={changedPaste}></textarea>
    <label for={`finance-${fieldKey}-delimiter`}>Pasted delimiter</label>
    <select id={`finance-${fieldKey}-delimiter`} bind:value={delimiter} on:change={() => { previewReady = false; if (paste) { error = 'Preview pasted rows with the selected delimiter.'; dispatch('change', { key: fieldKey, value: null, valid: false }); } }}><option value="comma">Comma (CSV)</option><option value="tab">Tab (TSV)</option><option value="semicolon">Semicolon</option><option value="pipe">Pipe</option></select>
    <button type="button" on:click={preview}>Preview pasted {label}</button>
    {#if previewReady}<p role="status">Parsed preview ready: {items.length} rows. Review the labeled cells below.</p>{/if}
  </div>
  {#each items.slice(page * pageSize, (page + 1) * pageSize) as row, visibleIndex}
    {@const index = page * pageSize + visibleIndex}
    <fieldset class="row">
      <legend>{label} row {index + 1}</legend>
      {#each contract.columns as column}
        {@const id = `finance-${fieldKey}-${index}-${column.key}`}
        {#if contract.bands && column.key === 'upperBound'}
          <label><input type="checkbox" checked={!Object.hasOwn(row, column.key)} on:change={(event) => include(index, column.key, !(event.currentTarget as HTMLInputElement).checked)} />Remaining amount, row {index + 1}</label>
        {:else if column.optional && column.default === undefined}
          <label><input type="checkbox" checked={Object.hasOwn(row, column.key)} on:change={(event) => include(index, column.key, (event.currentTarget as HTMLInputElement).checked)} />Include {column.label}, row {index + 1}</label>
        {/if}
        {#if !column.optional || Object.hasOwn(row, column.key)}
          <label for={id}>{column.label}, row {index + 1}</label>
          <input {id} type={column.type === 'number' ? 'number' : 'text'} value={row[column.key] ?? ''} min={column.min} max={column.max} step={column.integer ? 1 : 'any'} maxlength={column.maxLength} on:input={(event) => update(index, column.key, event, column.type === 'number')} />
        {/if}
      {/each}
      <button type="button" on:click={() => remove(index)}>Remove {label} row {index + 1}</button>
    </fieldset>
  {/each}
  <div class="actions"><button type="button" disabled={items.length >= contract.maxRows} on:click={addRow}>Add {label} row</button><button type="button" disabled={page === 0} on:click={() => page--}>Previous {label} rows</button><span>Page {page + 1} of {pageCount}; {items.length} total rows</span><button type="button" disabled={page + 1 >= pageCount} on:click={() => page++}>Next {label} rows</button></div>
  {#if error}<p role="alert">{error}</p>{/if}
</fieldset>

<style>
  .finance-rows, .row, .paste-controls { display: grid; gap: var(--space-2); }
  .finance-rows, .row { border: 1px solid var(--border); padding: var(--space-3); }
  p { margin: 0; color: var(--text-secondary); }
  input, textarea, select, button { font: inherit; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); min-width: 0; }
  textarea { resize: vertical; }
  button { cursor: pointer; } button:disabled { opacity: 0.6; cursor: default; }
  .actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
  input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
