<script lang="ts">
  import { onDestroy } from 'svelte';
import { editCsvCell, exportCsv, runCsvFileJob, selectCsvRows, type CsvDelimiter, type CsvFileJob, type CsvTable } from '@wyreup/core/execution';
  import DropZone from './DropZone.svelte';
  import type { PreloadAdmission, SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedParser: ((job: CsvFileJob, signal: AbortSignal) => Promise<CsvTable>) | undefined = undefined;
  let files: File[] = [];
  let paste = '';
  let delimiter: CsvDelimiter = 'auto';
  let hasHeader = true;
  let table: CsvTable | null = null;
  let error = '';
  let running = false;
  let notice = '';
  let generation = 0;
  let controller: AbortController | null = null;
  let search = '';
  let filterColumn = '';
  let filterText = '';
  let sortColumn = '';
  let sortDirection: 'asc' | 'desc' = 'asc';
  let numericSort = false;
  let page = 0;
  let spreadsheetSafe = false;
  let exportSelection: 'all' | 'current' = 'all';
  let editing: { row: string; column: string } | null = null;
  let draft = '';
  const urls = new Set<string>();
  let destroyed = false;
  let observedPreload: File | null = null;
  let operationFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function report(file: File | null, status: 'admitted' | 'refused') {
    if (!destroyed && file && file === preloadedFile && files[0] === file)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'CSV parsing did not complete.' });
  }
  function stagePreload(file: File | null) {
    observedPreload = file; invalidate(); files = []; paste = '';
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); files = [file]; }
  }

  $: selected = table ? selectCsvRows(table, {
    search,
    ...(filterColumn ? { filters: { [filterColumn]: filterText } } : {}),
    ...(sortColumn ? { sort: { column: sortColumn, direction: sortDirection, numeric: numericSort } } : {}),
  }) : [];
  $: pageCount = Math.max(1, Math.ceil(selected.length / 100));
  $: page = Math.min(page, pageCount - 1);
  $: visible = selected.slice(page * 100, (page + 1) * 100);

  function clearUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  function cancel() { if (running) report(operationFile, 'refused'); generation++; controller?.abort(); controller = null; running = false; operationFile = null; }
  function invalidate() { cancel(); table = null; editing = null; error = ''; notice = ''; clearUrls(); }
  function controlsChanged() { page = 0; editing = null; notice = ''; }

  function fileChanged(event: CustomEvent<File[]>) {
    invalidate(); files = event.detail; paste = '';
  }

  async function load() {
    cancel(); clearUrls(); table = null; error = ''; notice = ''; editing = null;
    const ownGeneration = generation;
    const ownController = new AbortController();
    const ownFile = files[0] ?? null, ownTool = tool;
    operationFile = ownFile;
    controller = ownController; running = true;
    try {
      let bytes: Uint8Array;
      if (files.length) {
        if (ownFile!.size > 10 * 1024 * 1024) throw new Error('CSV input exceeds 10 MiB.');
        bytes = new Uint8Array(await ownFile!.arrayBuffer());
      } else {
        for (let i = 0; i < paste.length; i++) {
          const n = paste.charCodeAt(i);
          if (n >= 0xd800 && n <= 0xdbff) {
            const next = paste.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Paste contains an unpaired Unicode surrogate.');
          } else if (n >= 0xdc00 && n <= 0xdfff) throw new Error('Paste contains an unpaired Unicode surrogate.');
        }
        const file = new File([paste], 'pasted.csv', { type: 'text/csv' });
        if (file.size > 10 * 1024 * 1024) throw new Error('CSV input exceeds 10 MiB.');
        bytes = new Uint8Array(await file.arrayBuffer());
      }
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      const parsed = await (injectedParser ?? runCsvFileJob)({ type: 'csv-parse', bytes, params: { delimiter, hasHeader } }, ownController.signal);
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      selectCsvRows(parsed, {});
      table = parsed;
      search = ''; filterColumn = ''; filterText = ''; sortColumn = ''; page = 0;
      report(ownFile, 'admitted');
    } catch (cause) {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { error = cause instanceof Error ? cause.message : 'CSV could not be loaded.'; report(ownFile, 'refused'); }
    } finally {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { running = false; controller = null; operationFile = null; }
    }
  }

  function beginEdit(row: string, column: string, value: string) { editing = { row, column }; draft = value; error = ''; }
  function commitEdit() {
    if (!table || !editing) return;
    try { table = editCsvCell(table, editing.row, editing.column, draft); editing = null; error = ''; notice = 'Cell updated.'; clearUrls(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Cell edit failed.'; }
  }

  function download() {
    if (!table) return;
    try {
      const text = exportCsv(table, { spreadsheetSafe, ...(exportSelection === 'current' ? { rows: selected } : {}) });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      urls.add(url);
      const link = document.createElement('a'); link.href = url; link.download = 'edited.csv'; link.click();
      notice = `Exported ${exportSelection === 'current' ? selected.length : table.rows.length} rows.`;
      error = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'CSV export failed.'; }
  }
  onDestroy(() => { destroyed = true; cancel(); clearUrls(); });
</script>

<div class="csv-viewer">
  <p>{tool.description}</p>
  <DropZone accept={tool.input.accept} sizeLimit={tool.input.sizeLimit} on:files={fileChanged} bind:files />
  <label>Or paste CSV<textarea aria-label="Paste CSV" bind:value={paste} on:input={() => { files = []; invalidate(); }} rows="6"></textarea></label>
  <div class="controls">
    <label>Input delimiter<select aria-label="Input delimiter" bind:value={delimiter} on:change={invalidate}>{#each ['auto', 'comma', 'tab', 'semicolon', 'pipe'] as value}<option {value}>{value}</option>{/each}</select></label>
    <label><input type="checkbox" bind:checked={hasHeader} on:change={invalidate} /> First row is a header</label>
    <button type="button" disabled={running} on:click={load}>{running ? 'Loading…' : 'Load CSV'}</button>
    {#if running}<button type="button" on:click={cancel}>Cancel</button>{/if}
  </div>
  {#if running}<p role="status">Parsing CSV in an owned local worker.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if table}
    <p>{table.rows.length} data rows, {table.columns.length} columns. Values remain text.</p>
    {#if table.warnings.length}<p role="status">{table.warnings.length} ragged rows were padded; original source-row numbers are retained.</p>{/if}
    <div class="controls">
      <label>Search all rows<input type="search" bind:value={search} on:input={controlsChanged} /></label>
      <label>Filter column<select aria-label="Filter column" bind:value={filterColumn} on:change={controlsChanged}><option value="">None</option>{#each table.columns as column}<option value={column.id}>{column.id}: {column.label || '(blank header)'}</option>{/each}</select></label>
      <label>Filter text<input bind:value={filterText} on:input={controlsChanged} /></label>
      <label>Sort column<select aria-label="Sort column" bind:value={sortColumn} on:change={controlsChanged}><option value="">Original order</option>{#each table.columns as column}<option value={column.id}>{column.id}: {column.label || '(blank header)'}</option>{/each}</select></label>
      <label>Sort direction<select aria-label="Sort direction" bind:value={sortDirection} on:change={controlsChanged}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <label><input type="checkbox" bind:checked={numericSort} on:change={controlsChanged} /> Numeric sort (invalid values last)</label>
    </div>
    <p role="status">{selected.length} matching rows. Page {page + 1} of {pageCount}.</p>
    {#if !table.rows.length}<p>Empty data. You can download the empty CSV.</p>{/if}
    <div class="table-wrap"><table>
      <thead><tr><th>Source row</th>{#each table.columns as column}<th>{column.label || '(blank header)'} <small>{column.id}</small></th>{/each}</tr></thead>
      <tbody>{#each visible as row (row.id)}<tr><th scope="row">{row.sourceRow}</th>{#each table.columns as column, index}<td>
        {#if editing?.row === row.id && editing.column === column.id}
          <textarea aria-label={`Edit source row ${row.sourceRow} ${column.id}`} bind:value={draft} on:keydown={event => { if (event.key === 'Escape') editing = null; if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commitEdit(); } }}></textarea>
          <button type="button" on:click={commitEdit}>Save cell</button><button type="button" on:click={() => { editing = null; }}>Cancel edit</button>
        {:else}<button type="button" class="cell" aria-label={`Edit source row ${row.sourceRow} ${column.id}`} on:click={() => beginEdit(row.id, column.id, row.cells[index]!)}>{row.cells[index] || '(empty)'}</button>{/if}
      </td>{/each}</tr>{/each}</tbody>
    </table></div>
    <div class="controls"><button type="button" disabled={page === 0} on:click={() => { page--; editing = null; }}>Previous page</button><button type="button" disabled={page + 1 >= pageCount} on:click={() => { page++; editing = null; }}>Next page</button></div>
    <div class="controls">
      <label>Export rows<select aria-label="Export rows" bind:value={exportSelection}><option value="all">All edited rows</option><option value="current">Current matching and sorted rows</option></select></label>
      <label><input type="checkbox" bind:checked={spreadsheetSafe} /> Spreadsheet-safe text</label>
      <button type="button" on:click={download}>Download CSV</button>
    </div>
    {#if spreadsheetSafe}<p>Formula-like values gain an apostrophe. Signed numeric cells may become spreadsheet text.</p>{/if}
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .csv-viewer { display: grid; gap: var(--space-3); }
  .controls { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
  label { display: grid; gap: var(--space-1); }
  textarea, input, select, button { font: inherit; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2); }
  textarea { max-width: 100%; min-height: 4rem; }
  .table-wrap { overflow: auto; max-width: 100%; }
  table { border-collapse: collapse; text-align: left; }
  th, td { padding: var(--space-2); border: 1px solid var(--border); vertical-align: top; }
  .cell { white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; min-width: 5rem; max-width: 22rem; }
  button { cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
