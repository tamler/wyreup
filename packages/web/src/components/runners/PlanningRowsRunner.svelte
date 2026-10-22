<script lang="ts">
  import { onDestroy } from 'svelte';
import { parsePlanningRows, parseGradeWeight, type PlanningRow, type PlanningRowsKind, type ToolModule } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  import type { SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  const kind: PlanningRowsKind = tool.id === 'gpa-calculator' ? 'gpa' : tool.id === 'grade-calculator' ? 'grade' : 'cocktail';
  const defaults = Object.fromEntries(Object.entries(tool.defaults).filter(([key]) => key !== 'remainingWeight'));
  const schema = Object.fromEntries(Object.entries(tool.paramSchema ?? {}).filter(([key]) => key !== 'remainingWeight')) as UtilitySchema;
  let params = { ...defaults }; let remainingWeight = String(tool.defaults.remainingWeight ?? '30'); let formValid = false; let rows: PlanningRow[] = [];
  let error = ''; let rowError = ''; let result = ''; let resultBlob: Blob | null = null; let notice = ''; let running = false; let controller: AbortController | null = null; let generation = 0;
  function clear() { generation++; controller?.abort(); result = ''; resultBlob = null; running = false; error = ''; notice = ''; }
  function preview() { try { rows = parsePlanningRows(String(params.rowsText ?? ''), kind, String(params.delimiter), params.hasHeader === true, Number(params.scale ?? 4)); if (kind === 'grade') parseGradeWeight(remainingWeight); rowError = ''; } catch (cause) { rows = []; rowError = cause instanceof Error ? cause.message : 'Invalid rows.'; } }
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) { params = event.detail.params; formValid = event.detail.valid; clear(); preview(); }
  function weightChanged(event: Event) { remainingWeight = (event.currentTarget as HTMLInputElement).value; clear(); preview(); }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return; clear(); const own = generation;
    try { if (file.size > 102400) throw new Error('Rows exceed 100 KiB.'); const raw = await file.text(); if (own !== generation) return; params = { ...params, rowsText: raw, delimiter: file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',' }; preview(); }
    catch (cause) { if (own === generation) rowError = cause instanceof Error ? cause.message : 'Import failed.'; }
  }
  async function run() {
    if (!formValid || rowError) return; clear(); const own = generation; const current = new AbortController(); controller = current; running = true;
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id); if (!module) throw new Error('Tool unavailable.');
      const output = await module.run([], { ...params, ...(kind === 'grade' ? { remainingWeight } : {}) }, { signal: current.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: () => {} }); const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'application/json' || blobs[0]!.size > 1048576) throw new Error('Expected one bounded JSON result.');
      const raw = await blobs[0]!.text(); JSON.parse(raw); if (own === generation) { result = raw; resultBlob = blobs[0]!; }
    } catch (cause) { if (own === generation) error = cause instanceof Error ? cause.message : 'Calculation failed.'; }
    finally { if (own === generation) running = false; }
  }
  async function copy() { try { await navigator.clipboard.writeText(result); notice = 'Copied JSON.'; } catch { notice = 'Copy unavailable; use Download JSON.'; } }
  function download() { if (!resultBlob) return; const url = URL.createObjectURL(resultBlob); const link = document.createElement('a'); link.href = url; link.download = `${tool.id}.json`; link.click(); URL.revokeObjectURL(url); }
  onDestroy(clear);
</script>
<div class="rows-runner">
  <label>Import local CSV or TSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" on:change={importFile} /></label>
  <UtilityForm {defaults} {params} paramSchema={schema} on:change={changed} />
  {#if kind === 'grade'}<label>Remaining weight (%)<input type="text" inputmode="decimal" maxlength="6" value={remainingWeight} on:input={weightChanged} /></label>{/if}
  {#if rowError}<p role="alert">{rowError}</p>{/if}
  {#if rows.length}<div class="table-wrap"><table><caption>Parsed input preview</caption><thead><tr><th>Row</th><th>Name</th><th>{kind === 'gpa' ? 'Credits' : kind === 'grade' ? 'Grade' : 'Volume (mL)'}</th><th>{kind === 'gpa' ? 'Points' : kind === 'grade' ? 'Weight (%)' : 'ABV (%)'}</th></tr></thead><tbody>{#each rows as row}<tr><td>{row.row}</td><td>{row.name}</td><td>{row.first}</td><td>{kind === 'grade' ? `${row.weightText} (${row.second / 100}%)` : row.second}</td></tr>{/each}</tbody></table></div>{/if}
  <div class="actions"><button type="button" disabled={!formValid || !!rowError || running} on:click={run}>Calculate</button>{#if running}<button type="button" on:click={clear}>Cancel</button>{/if}</div>
  {#if error}<p role="alert">{error}</p>{/if}{#if resultBlob}<FlatJsonResult json={result} /><div class="actions"><button type="button" on:click={copy}>Copy JSON</button><button type="button" on:click={download}>Download JSON</button></div>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .rows-runner { display: grid; gap: var(--space-3); } .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; } label { display: grid; gap: var(--space-1); }
  input, button { font: inherit; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2); background: var(--bg-raised); color: var(--text-primary); } button:disabled { opacity: .6; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; } .table-wrap { overflow-x: auto; } th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
</style>
