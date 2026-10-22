<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolModule, ToolProgress } from '@wyreup/core';
  import UtilityForm from './UtilityForm.svelte';
  import GeneratorRows from './GeneratorRows.svelte';
  import { generatorRowContracts } from './generatorRows';
  import { initialUtilityParams, type UtilitySchema } from './utilityFormState';
  import type { SerializedTool } from './types';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  const contracts = generatorRowContracts(tool.id);
  const rowKeys = contracts.map(({ key }) => key);
  const scalarSchema = Object.fromEntries(Object.entries(tool.paramSchema ?? {}).filter(([key]) => !rowKeys.includes(key))) as UtilitySchema;
  const scalarDefaults = Object.fromEntries(Object.entries(tool.defaults).filter(([key]) => !rowKeys.includes(key)));
  let params = initialUtilityParams(tool.defaults);
  $: scalarParams = Object.fromEntries(Object.entries(params).filter(([key]) => !rowKeys.includes(key)));
  let scalarValid = false;
  let rowValid: Record<string, boolean> = {};
  $: valid = scalarValid && rowKeys.every((key) => rowValid[key] === true);
  let running = false;
  let error = '';
  let notice = '';
  let result = '';
  let resultBlob: Blob | null = null;
  let progress: ToolProgress = { stage: 'processing' };
  let generation = 0;
  let formGeneration = 0;
  let controller: AbortController | null = null;
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  function clearResult() {
    for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.clear(); result = ''; resultBlob = null; notice = '';
  }
  function cancel() { generation++; controller?.abort(); controller = null; running = false; }
  function invalidate() { cancel(); clearResult(); error = ''; }
  function scalarChanged(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    const changed = Object.keys(scalarSchema).some((key) => !Object.is(params[key], event.detail.params[key]));
    if (changed || !event.detail.valid) invalidate();
    if (changed) params = { ...params, ...event.detail.params };
    scalarValid = event.detail.valid;
  }
  function rowsChanged(event: CustomEvent<{ key: string; value: string | null; valid: boolean }>) {
    const { key, value, valid: rowIsValid } = event.detail;
    if (!rowKeys.includes(key)) return;
    if (params[key] !== value || !rowIsValid) invalidate();
    if (rowIsValid && params[key] !== value) params = { ...params, [key]: value };
    if (rowValid[key] !== rowIsValid) rowValid = { ...rowValid, [key]: rowIsValid };
  }
  async function run() {
    if (!valid) return;
    invalidate(); const own = generation; const active = new AbortController(); controller = active; running = true; progress = { stage: 'processing' };
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (own !== generation) return;
      if (!module) throw new Error('Generator unavailable.');
      const output = await module.run([], params, { signal: active.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: (value) => { if (own === generation) progress = value; } });
      if (own !== generation) return;
      const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== tool.output.mime) throw new Error('Expected one complete generator artifact with the declared MIME.');
      if (blobs[0]!.size > 20 * 1024 * 1024) throw new Error('Generator artifact exceeds 20 MiB.');
      const text = await blobs[0]!.text();
      if (own !== generation) return;
      result = text; resultBlob = blobs[0]!;
    } catch (cause) { if (own === generation) error = cause instanceof Error ? cause.message : 'Generation failed.'; }
    finally { if (own === generation) { running = false; controller = null; } }
  }
  function clear() { invalidate(); params = initialUtilityParams(tool.defaults); rowValid = {}; scalarValid = false; formGeneration++; }
  function download() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob); const link = document.createElement('a'); link.href = url;
    link.download = tool.id === 'robots-txt-generator' ? 'robots.txt' : tool.id === 'hreflang-tag-generator' ? 'hreflang.html' : tool.id === 'nginx-redirect-generator' ? 'redirects.conf' : 'csp-header.txt'; link.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); downloads.set(url, timer);
  }
  async function copy() {
    const own = generation;
    try { await navigator.clipboard.writeText(result); if (own === generation) notice = 'Copied complete output.'; }
    catch { if (own === generation) notice = 'Copy unavailable. Use Download output.'; }
  }
  onDestroy(() => { cancel(); clearResult(); });
</script>

<div class="generator-runner">
  <p>{tool.description} Output is a local configuration draft; review it before applying it.</p>
  {#key formGeneration}
    <UtilityForm defaults={scalarDefaults} params={scalarParams} paramSchema={scalarSchema} on:change={scalarChanged} />
    {#each contracts as contract (contract.key)}<GeneratorRows {contract} value={params[contract.key]} on:change={rowsChanged} />{/each}
  {/key}
  <div class="actions"><button type="button" disabled={!valid || running} on:click={run}>{running ? 'Generating…' : 'Generate'}</button>{#if running}<button type="button" on:click={() => { invalidate(); notice = 'Generation cancelled.'; }}>Cancel</button>{/if}<button type="button" on:click={clear}>Clear and reset</button></div>
  {#if running}<p role="status">{progress.message ?? 'Generating…'}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if resultBlob}
    <section aria-label="Generated literal output"><h3>Generated output</h3><p>{resultBlob.size} UTF8 bytes. Code is displayed as literal text.</p>{#if result.length > 20000}<p>Preview shows the first 20,000 characters. Copy and download retain the complete output.</p>{/if}<pre>{result.slice(0, 20000)}</pre>{#if !result}<p>Empty output.</p>{/if}</section>
    <div class="actions"><button type="button" on:click={copy}>Copy output</button><button type="button" on:click={download}>Download output</button></div>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .generator-runner { display: grid; gap: var(--space-3); min-width: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  button { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; } button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  pre { margin: 0; max-height: 28rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--border); padding: var(--space-3); }
</style>
