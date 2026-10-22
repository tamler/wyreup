<script lang="ts">
  import { onDestroy } from 'svelte';
import { validateContractParticulars, type ToolModule } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import type { SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  let params = { ...tool.defaults }; let valid = false; let draft = ''; let generated = ''; let edited = false; let running = false; let error = ''; let notice = '';
  let controller: AbortController | null = null; let generation = 0; let printContainer: HTMLDivElement;
  async function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    const own = ++generation; controller?.abort(); params = event.detail.params; valid = false; running = false; error = '';
    if (!event.detail.valid) { draft = ''; generated = ''; edited = false; return; }
    try { await validateContractParticulars(params); if (own === generation) valid = true; }
    catch (cause) { if (own === generation) { draft = ''; generated = ''; edited = false; error = cause instanceof Error ? cause.message : 'Invalid particulars.'; } }
  }
  async function generate() {
    if (!valid) return; controller?.abort(); const own = ++generation; const current = new AbortController(); controller = current; running = true; error = '';
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id); if (!module) throw new Error('Tool unavailable.');
      const output = await module.run([], params, { signal: current.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: () => {} }); const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'application/json' || blobs[0]!.size > 1048576) throw new Error('Expected one bounded JSON result.');
      const parsed: unknown = JSON.parse(await blobs[0]!.text()); if (!parsed || typeof parsed !== 'object' || typeof (parsed as { draft?: unknown }).draft !== 'string') throw new Error('Invalid draft result.');
      if (own === generation) { draft = (parsed as { draft: string }).draft; generated = draft; edited = false; }
    } catch (cause) { if (own === generation) { draft = ''; generated = ''; edited = false; error = cause instanceof Error ? cause.message : 'Draft generation failed.'; } }
    finally { if (own === generation) running = false; }
  }
  function edit(event: Event) { const value = (event.currentTarget as HTMLTextAreaElement).value; if (new TextEncoder().encode(value).length > 102400) { error = 'Edited draft exceeds 100 KiB.'; return; } draft = value; edited = draft !== generated; error = ''; }
  async function copy() { try { await navigator.clipboard.writeText(draft); notice = 'Copied draft.'; } catch { notice = 'Copy unavailable; use Download text.'; } }
  function download() { const url = URL.createObjectURL(new Blob([draft], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = 'photography-agreement-draft.txt'; link.click(); URL.revokeObjectURL(url); }
  function print() { printContainer.replaceChildren(); const heading = document.createElement('h1'); heading.textContent = 'Photography agreement draft'; const content = document.createElement('pre'); content.textContent = draft; printContainer.append(heading, content); window.print(); }
  onDestroy(() => { generation++; controller?.abort(); });
</script>
<div class="contract-runner">
  <div class="editor"><UtilityForm defaults={tool.defaults} {params} paramSchema={tool.paramSchema as UtilitySchema} on:change={changed} /><p>Draft for review; add applicable terms before signing. This template makes no jurisdiction-specific enforceability claim.</p><button type="button" disabled={!valid || running} on:click={generate}>{edited ? 'Replace edited draft from particulars' : 'Generate draft'}</button>{#if draft}<label>Editable agreement draft<textarea rows="20" value={draft} on:input={edit}></textarea></label><div class="actions"><button type="button" on:click={copy}>Copy draft</button><button type="button" on:click={download}>Download text</button><button type="button" on:click={print}>Print draft</button></div><section aria-label="Agreement preview"><h3>Draft preview</h3><pre>{draft}</pre></section>{/if}{#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}</div>
  <div class="print-container" bind:this={printContainer}></div>
</div>
<style>
  .editor { display: grid; gap: var(--space-3); } label { display: grid; gap: var(--space-1); } .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); } textarea, button { font: inherit; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); } button:disabled { opacity: .6; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; } button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; } .print-container { display: none; } @media print { .editor { display: none; } .print-container { display: block; color: black; background: white; } .print-container :global(pre) { white-space: pre-wrap; font: inherit; } }
</style>
