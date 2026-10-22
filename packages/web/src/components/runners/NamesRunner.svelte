<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolModule } from '@wyreup/core';
  import UtilityForm from './UtilityForm.svelte';
  import type { SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  let params = { ...tool.defaults }; let valid = false; let running = false; let error = ''; let notice = '';
  let ideas: { name: string; tag: string }[] = []; let selected = new Set<number>(); let controller: AbortController | null = null; let generation = 0;
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) { generation++; controller?.abort(); params = event.detail.params; valid = event.detail.valid; ideas = []; selected = new Set(); error = ''; notice = ''; running = false; }
  async function generate() {
    if (!valid) return; controller?.abort(); const own = ++generation; const current = new AbortController(); controller = current; running = true; error = ''; ideas = [];
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id); if (!module) throw new Error('Tool unavailable.');
      const output = await module.run([], params, { signal: current.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: () => {} }); const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'application/json' || blobs[0]!.size > 1048576) throw new Error('Expected one bounded JSON result.');
      const parsed: unknown = JSON.parse(await blobs[0]!.text());
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { ideas?: unknown }).ideas)) throw new Error('Invalid name result.');
      const rows = (parsed as { ideas: unknown[] }).ideas;
      if (rows.length > 50) throw new Error('Too many name ideas.');
      const normalized = rows.map(row => { if (!row || typeof row !== 'object' || typeof (row as { name?: unknown }).name !== 'string' || typeof (row as { tag?: unknown }).tag !== 'string') throw new Error('Invalid name row.'); return row as { name: string; tag: string }; });
      if (own === generation) { ideas = normalized; selected = new Set(ideas.map((_, i) => i)); }
    } catch (cause) { if (own === generation) error = cause instanceof Error ? cause.message : 'Generation failed.'; }
    finally { if (own === generation) running = false; }
  }
  function lines(indexes: number[]) { return indexes.map(index => `${ideas[index]!.name}${ideas[index]!.tag ? ` [${ideas[index]!.tag}]` : ''}`).join('\n'); }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); notice = 'Copied names.'; } catch { notice = 'Copy unavailable; use Download names.'; } }
  function download() { const url = URL.createObjectURL(new Blob([lines([...selected])], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = `${tool.id}.txt`; link.click(); URL.revokeObjectURL(url); }
  function select(index: number, checked: boolean) { const next = new Set(selected); if (checked) next.add(index); else next.delete(index); selected = next; }
  onDestroy(() => { generation++; controller?.abort(); });
</script>
<div class="names-runner">
  <UtilityForm defaults={tool.defaults} {params} paramSchema={tool.paramSchema as UtilitySchema} on:change={changed} />
  <button type="button" disabled={!valid || running} on:click={generate}>Generate names</button>
  <p>Name ideas; availability and trademarks have not been checked.</p>{#if tool.id === 'clan-name-generator'}<p>Tags are abbreviations and may collide.</p>{/if}
  {#if ideas.length}<ol>{#each ideas as idea, index}<li><label><input type="checkbox" checked={selected.has(index)} on:change={event => select(index, event.currentTarget.checked)} />{idea.name}{idea.tag ? ` [${idea.tag}]` : ''}</label><button type="button" on:click={() => copy(lines([index]))}>Copy name {index + 1}</button></li>{/each}</ol><div class="actions"><button type="button" on:click={() => copy(lines(ideas.map((_, i) => i)))}>Copy all names</button><button type="button" disabled={!selected.size} on:click={() => copy(lines([...selected]))}>Copy selected names</button><button type="button" disabled={!selected.size} on:click={download}>Download names</button></div>{/if}
  {#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .names-runner { display: grid; gap: var(--space-3); } .actions, li { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; } li { margin-bottom: var(--space-2); } button { font: inherit; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); } button:disabled { opacity: .6; } button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
