<script lang="ts">
  import { onDestroy } from 'svelte';
import { utilityFieldVisible, type ToolModule, type ToolProgress } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import FinanceRows from './FinanceRows.svelte';
  import { financeRowContract } from './financeRows';
  import { financeCell, financeLabel, financeSummaryText, financeTablePage, prepareFinanceResult, type FinanceResultView } from './financeResults';
  import { initialUtilityParams, type UtilitySchema } from './utilityFormState';
  import type { SerializedTool } from './types';
import { financeSourcesForTool } from '@wyreup/core/execution';
  import { financeSourceHref } from './financeResults';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  const fullSchema = tool.paramSchema as UtilitySchema;
  const inputSources = financeSourcesForTool(tool.id);
  const rowKeys = Object.keys(fullSchema).filter((key) => financeRowContract(tool.id, key));
  const scalarSchema = Object.fromEntries(Object.entries(fullSchema).filter(([key]) => !rowKeys.includes(key))) as UtilitySchema;
  const scalarDefaults = Object.fromEntries(Object.entries(tool.defaults).filter(([key]) => !rowKeys.includes(key)));
  let params = initialUtilityParams(tool.defaults);
  $: scalarParams = Object.fromEntries(Object.entries(params).filter(([key]) => !rowKeys.includes(key)));
  let scalarValid = false;
  let rowValid: Record<string, boolean> = {};
  $: valid = scalarValid && rowKeys.every((key) => !utilityFieldVisible(fullSchema[key]!, params) || rowValid[key] === true);
  let running = false;
  let error = '';
  let resultJson = '';
  let resultBlob: Blob | null = null;
  let view: FinanceResultView | null = null;
  let pages: Record<string, number> = {};
  let notice = '';
  let progress: ToolProgress = { stage: 'processing' };
  let controller: AbortController | null = null;
  let generation = 0;
  const urls = new Set<string>();
  function clearResult() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); resultJson = ''; resultBlob = null; view = null; pages = {}; notice = ''; }
  function cancel() { generation++; controller?.abort(); controller = null; running = false; }
  function invalidate() { cancel(); clearResult(); error = ''; }
  function scalarChanged(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    const different = Object.keys(scalarSchema).some((key) => !Object.is(params[key], event.detail.params[key]));
    if (different || !event.detail.valid) invalidate();
    if (different) params = { ...params, ...event.detail.params };
    if (scalarValid !== event.detail.valid) scalarValid = event.detail.valid;
  }
  function rowsChanged(event: CustomEvent<{ key: string; value: string | null; valid: boolean }>) {
    const { key, value, valid: isValid } = event.detail;
    if (params[key] !== value || !isValid) invalidate();
    // Retain the last parsed value while an invalid row draft is edited. Its
    // separate validity cancels stale work without resetting the visible draft.
    if (isValid && params[key] !== value) params = { ...params, [key]: value };
    if (rowValid[key] !== isValid) rowValid = { ...rowValid, [key]: isValid };
  }
  async function run() {
    if (!valid) return;
    invalidate(); const ownGeneration = generation; const ownController = new AbortController(); controller = ownController; running = true;
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (generation !== ownGeneration) return;
      if (!module) throw new Error('Finance tool unavailable.');
      const output = await module.run([], params, { signal: ownController.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: (value) => { if (generation === ownGeneration) progress = value; } });
      if (generation !== ownGeneration) return;
      const blobs = Array.isArray(output) ? output : [output]; if (blobs.length !== 1 || blobs[0]!.type !== 'application/json') throw new Error('Expected one complete JSON finance result.');
      const text = await blobs[0]!.text(); if (generation !== ownGeneration) return;
      const prepared = prepareFinanceResult(text); if (generation !== ownGeneration) return;
      resultJson = text; resultBlob = blobs[0]!; view = prepared;
    } catch (cause) { if (generation === ownGeneration) error = cause instanceof Error ? cause.message : 'Calculation failed.'; }
    finally { if (generation === ownGeneration) { running = false; controller = null; } }
  }
  function download() { if (!resultBlob) return; const url = URL.createObjectURL(resultBlob); urls.add(url); const link = document.createElement('a'); link.href = url; link.download = `${tool.id}.json`; link.click(); }
  async function copy(summary = false) { try { await navigator.clipboard.writeText(summary && view ? financeSummaryText(view) : resultJson); notice = summary ? 'Copied readable summary.' : 'Copied complete JSON.'; } catch { notice = 'Copy unavailable. Use Download JSON.'; } }
  function isAssumption(label: string) { return label.startsWith('Inputs / ') || label.startsWith('Assumptions / '); }
  function page(id: string, delta: number) { pages = { ...pages, [id]: Math.max(0, (pages[id] ?? 0) + delta) }; }
  onDestroy(() => { cancel(); clearResult(); });
</script>

<div class="finance-runner">
  <p>Local estimate using your entered assumptions. Money uses the selected currency; raw fields preserve estimates and settled fields use declared minor-unit rounding.</p>
  {#if inputSources.length}<p>Enter your actual plan, contract, territory and payment-method rates. Official definitions checked 2026-10-11:</p><ul>{#each inputSources as source}<li>{#if financeSourceHref(source.url)}<a href={financeSourceHref(source.url)!} target="_blank" rel="noopener noreferrer">{source.url}</a>{:else}{source.url}{/if}</li>{/each}</ul>{/if}
  <UtilityForm defaults={scalarDefaults} params={scalarParams} paramSchema={scalarSchema} on:change={scalarChanged} />
  {#each rowKeys as key (key)}
    {#if utilityFieldVisible(fullSchema[key]!, params)}<FinanceRows fieldKey={key} label={fullSchema[key]!.label ?? financeLabel(key)} value={params[key]} contract={financeRowContract(tool.id, key)!} on:change={rowsChanged} />{/if}
  {/each}
  <div class="actions"><button type="button" disabled={!valid || running} on:click={run}>{running ? 'Calculating…' : 'Calculate'}</button>{#if running}<button type="button" on:click={cancel}>Cancel</button>{/if}</div>
  {#if running}<p role="status">{progress.message ?? 'Calculating…'}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if view}
    <section aria-label="Finance result">
      <dl>{#each view.summary.filter((item) => !isAssumption(item.label)) as item}<div><dt>{item.label}</dt><dd>{financeCell(item.value)}</dd></div>{/each}</dl>
      <details><summary>Entered inputs and assumptions</summary><dl>{#each view.summary.filter((item) => isAssumption(item.label)) as item}<div><dt>{item.label}</dt><dd>{financeCell(item.value)}</dd></div>{/each}</dl></details>
      {#each view.tables as table}
        <section aria-label={table.label}>
          <h3>{table.label}</h3>
          <p>{table.rows.length} total rows; page {(pages[table.id] ?? 0) + 1} of {Math.max(1, Math.ceil(table.rows.length / 25))}. Complete rows are retained in the JSON artifact.</p>
          <div class="table-scroll"><table><caption>{table.label}</caption><thead><tr>{#each table.columns as column}<th scope="col">{financeLabel(column)}</th>{/each}</tr></thead><tbody>{#each financeTablePage(table, pages[table.id] ?? 0) as row}<tr>{#each table.columns as column}<td>{financeCell(row[column])}</td>{/each}</tr>{/each}</tbody></table></div>
          <div class="actions"><button type="button" disabled={(pages[table.id] ?? 0) === 0} on:click={() => page(table.id, -1)}>Previous {table.label} page</button><button type="button" disabled={(pages[table.id] ?? 0) + 1 >= Math.ceil(table.rows.length / 25)} on:click={() => page(table.id, 1)}>Next {table.label} page</button></div>
        </section>
      {/each}
      {#if view.sources.length}<details><summary>Official definitions and entered-rate scope</summary><p>Use the rates from your actual plan, contract, territory and payment method. These links are definitions, not a live quote or complete implemented schedule.</p><ul>{#each view.sources as source}<li>{#if source.href}<a href={source.href} target="_blank" rel="noopener noreferrer">{source.title}</a>{:else}{source.title}: {source.url}{/if} — checked {source.checkedOn}</li>{/each}</ul></details>{/if}
      {#if view.limitations.length}<h3>Estimate limitations</h3><ul>{#each view.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
    </section>
    <div class="actions"><button type="button" on:click={() => copy(true)}>Copy summary</button><button type="button" on:click={() => copy()}>Copy JSON</button><button type="button" on:click={download}>Download JSON</button></div>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .finance-runner { display: grid; gap: var(--space-3); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  button { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; } button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  dl > div { display: grid; grid-template-columns: minmax(8rem, 1fr) 2fr; gap: var(--space-2); padding: var(--space-1) 0; }
  dt { font-weight: 600; } dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid var(--border); padding: var(--space-2); text-align: left; overflow-wrap: anywhere; } caption { text-align: left; font-weight: 600; }
</style>
