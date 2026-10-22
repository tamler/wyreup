<script lang="ts">
  import { onDestroy } from 'svelte';
import { safeCsvCell, type ToolModule } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  import type { SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  let params = { ...tool.defaults }; let valid = false; let running = false; let error = ''; let notice = ''; let result = '';
  let history: { values: (number | string)[]; json: string }[] = []; let controller: AbortController | null = null; let generation = 0;
  $: flips = history.flatMap(set => set.values); $: headRatio = tool.id === 'coin-flip' && flips.length ? flips.filter(value => value === 'Heads').length / flips.length : null;
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) { generation++; controller?.abort(); params = event.detail.params; valid = event.detail.valid; result = ''; error = ''; running = false; }
  function preset(sides: number) { generation++; controller?.abort(); params = { ...params, sides }; result = ''; error = ''; running = false; }
  async function run() {
    if (!valid) return; controller?.abort(); const own = ++generation; const current = new AbortController(); controller = current; running = true; error = ''; result = '';
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id); if (!module) throw new Error('Tool unavailable.');
      const output = await module.run([], params, { signal: current.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: () => {} }); const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'application/json' || blobs[0]!.size > 1048576) throw new Error('Expected one bounded JSON result.');
      const raw = await blobs[0]!.text(); const parsed: unknown = JSON.parse(raw); const values = parsed && typeof parsed === 'object' ? (parsed as { values?: unknown }).values : null;
      if (!Array.isArray(values) || !values.length || values.length > 1000 || (values as unknown[]).some(value => typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))) throw new Error('Invalid random result.');
      if (own !== generation) return; result = raw; history = [...history, { values: values as (string | number)[], json: raw }];
      while (history.length > 100 || history.reduce((total, set) => total + set.values.length, 0) > 10000) history = history.slice(1);
    } catch (cause) { if (own === generation) error = cause instanceof Error ? cause.message : 'Random generation failed.'; }
    finally { if (own === generation) running = false; }
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); notice = 'Copied result.'; } catch { notice = 'Copy unavailable; use Export history CSV.'; } }
  function download() { const rows: (string | number)[][] = [['set', 'index', 'value']]; history.forEach((set, i) => set.values.forEach((value, j) => rows.push([i + 1, j + 1, value]))); const csv = rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = `${tool.id}-history.csv`; link.click(); URL.revokeObjectURL(url); }
  onDestroy(() => { generation++; controller?.abort(); });
</script>
<div class="random-runner">
  {#if tool.id === 'dice-roller'}<div class="actions" aria-label="Dice presets">{#each [4, 6, 8, 10, 12, 20, 100] as sides}<button type="button" on:click={() => preset(sides)}>d{sides}</button>{/each}</div>{/if}
  <UtilityForm defaults={tool.defaults} {params} paramSchema={tool.paramSchema as UtilitySchema} on:change={changed} />
  <button type="button" disabled={!valid || running} on:click={run}>{tool.id === 'dice-roller' ? 'Roll dice' : tool.id === 'coin-flip' ? 'Flip coins' : 'Generate numbers'}</button>
  {#if result}<FlatJsonResult json={result} />{/if}
  <h3>History — {history.length} sets</h3>{#if tool.id === 'coin-flip'}<p>Historical head ratio: {headRatio === null ? 'No flips yet' : headRatio}</p>{/if}
  <ol>{#each history as set, index}<li>{set.values.join(', ')} <button type="button" on:click={() => copy(set.values.join(', '))}>Copy set {index + 1}</button></li>{/each}</ol>
  <div class="actions"><button type="button" on:click={() => { history = []; notice = 'History cleared.'; }}>Clear history</button><button type="button" disabled={!history.length} on:click={download}>Export history CSV</button></div><p>History stays in memory in this tab. Cryptographic draws use unbiased integer sampling; this is not a fairness certification.</p>
  {#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .random-runner { display: grid; gap: var(--space-3); } .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); } button { font: inherit; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); } button:disabled { opacity: .6; } button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
