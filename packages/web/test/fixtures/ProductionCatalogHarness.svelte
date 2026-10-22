<script lang="ts">
  import { onMount } from 'svelte';
  import { createDefaultRegistry, type ToolModule } from '@wyreup/core';
  import ToolRunner from '../../src/components/ToolRunner.svelte';
  import type { SerializedTool } from '../../src/components/runners/types';
  import { stashChainFile, stashChainHandover, peekChainFile } from '../../src/components/runners/chainStorage';
  import { user, authReady } from '../../src/stores/user';
  import { projectToolDiscoveryMetadata } from '../../src/lib/tool-discovery-metadata';

  // The same package export resolves through Astro's browser condition.
  // There is no injectedTool, source alias, alternate registry or fake run().
  const registry = createDefaultRegistry();
  const tools = Array.from(registry.toolsById.values());
  let selectedId = tools[0]?.id ?? '';
  let currentFile: File | null = null;
  let deliveredFile: File | null = null;
  let mounted = false;
  let mountAttempt = 0;
  let routingNegative = false;
  let ready = false;
  let status = '';
  let actionGeneration = 0;

  function serialize(module: ToolModule): SerializedTool {
    const discovery = projectToolDiscoveryMetadata(module);
    return {
      id: module.id, slug: module.slug ?? module.id, name: module.name,
      description: discovery.description,
      category: module.category, keywords: discovery.keywords,
      input: { accept: module.input.accept, min: module.input.min, max: module.input.max, sizeLimit: module.input.sizeLimit },
      output: { mime: module.output.mime, multiple: module.output.multiple ?? false },
      defaults: module.defaults as Record<string, unknown>,
      paramSchema: module.paramSchema,
      requiresWebgpu: module.requires?.webgpu,
      requires: module.requires ? { webgpu: module.requires.webgpu, minMemoryGB: module.requires.minMemoryGB } : undefined,
      installSize: module.installSize, installGroup: module.installGroup,
      memoryEstimate: module.memoryEstimate, outputDisplay: module.outputDisplay,
      cost: module.cost, creditCost: module.creditCost,
      networkAccess: discovery.networkAccess,
    };
  }

  $: module = registry.toolsById.get(selectedId);
  $: serialized = module ? serialize(module) : null;
  // This sentinel tests missing routing metadata only, never a registered tool.
  $: target = serialized && routingNegative
    ? { ...serialized, id: '__acceptance_missing_mapping__', slug: '__acceptance_missing_mapping__', name: 'Routing-negative sentinel' }
    : serialized;

  onMount(() => {
    const requested = new URL(window.location.href).searchParams.get('tool');
    if (requested) selectedId = requested;
    ready = true;
    return () => { actionGeneration++; };
  });

  function choose(event: Event) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    currentFile = event.currentTarget.files?.[0] ?? null;
    actionGeneration++;
    status = currentFile ? `Selected ${currentFile.name}; not delivered.` : 'No file selected.';
  }

  function changeTool() {
    actionGeneration++;
    // A keyed real ToolRunner is destroyed on every tool-identity change.
    mountAttempt++;
    status = 'Target identity changed.';
  }

  function mountRunner() {
    actionGeneration++;
    mountAttempt++;
    mounted = true;
    status = 'Mounted real ToolRunner.';
  }

  function unmountRunner() {
    actionGeneration++;
    mounted = false;
    status = 'ToolRunner unmounted.';
  }

  async function stash(mode: 'target-bound' | 'unbound' | 'manual') {
    const file = currentFile;
    const selectedTool = registry.toolsById.get(selectedId);
    if (!file) return;
    if (mode === 'target-bound' && (!selectedTool || routingNegative)) {
      status = 'Select an actual registered target before binding automatic handover.';
      return;
    }
    const generation = ++actionGeneration;
    const options = mode === 'target-bound' && selectedTool
      ? { autoAccept: true, targetToolId: selectedTool.id }
      : { autoAccept: mode === 'unbound' };
    const stored = mode === 'target-bound'
      ? (await stashChainHandover(file, options)).stored
      : await stashChainFile(file, options);
    if (generation !== actionGeneration) return;
    status = stored
      ? `Stored ${file.name}; mode=${mode}${mode === 'target-bound' && selectedTool ? `; target=${selectedTool.id}` : ''}.`
      : 'Storage refused this file.';
  }

  async function observeStorage() {
    const generation = ++actionGeneration;
    const peeked = await peekChainFile();
    if (generation !== actionGeneration) return;
    status = peeked ? `Pending: ${peeked.name}; ${peeked.type}; autoAccept=${peeked.autoAccept === true}.` : 'No pending storage metadata.';
  }

  function deliver() {
    actionGeneration++;
    deliveredFile = currentFile;
    status = currentFile ? `Delivered exact selected File ${currentFile.name}.` : 'Delivered null.';
  }

  function clearDelivery() {
    actionGeneration++;
    deliveredFile = null;
    status = 'Parent preload cleared; selected File identity retained.';
  }

  function gate(state: 'loading' | 'signed-out') {
    user.set(null);
    authReady.set(state === 'signed-out');
    status = `Controlled real auth stores: ${state}; no account or credentials supplied.`;
  }
</script>

<section aria-label="Production catalog controlled fixture" data-ready={ready}>
  <h1>Production catalog controlled fixture</h1>
  <p>This isolated route mounts the real default registry and ToolRunner. It supplies user-like files and lifecycle controls, without changing tool algorithms. Actual /tools/id routes are checked separately.</p>
  <label>Registered tool
    <select aria-label="Registered tool" bind:value={selectedId} on:change={changeTool}>
      {#each tools as entry}<option value={entry.id}>{entry.id}</option>{/each}
    </select>
  </label>
  <label><input type="checkbox" bind:checked={routingNegative} on:change={changeTool} /> Routing-negative sentinel (not a registered tool)</label>
  <label>Parent input file <input aria-label="Parent input file" type="file" on:change={choose} /></label>
  <p data-selected-file>{currentFile?.name ?? 'No selected file'}</p>
  <button type="button" on:click={mountRunner} disabled={!ready || !target}>Mount / remount target</button>
  <button type="button" on:click={unmountRunner} disabled={!mounted}>Unmount target</button>
  <button type="button" on:click={deliver} disabled={!currentFile}>Deliver selected File</button>
  <button type="button" on:click={clearDelivery}>Clear parent preload</button>
  <button type="button" on:click={() => stash('target-bound')} disabled={!currentFile || !module || routingNegative}>Stash File for selected canonical tool</button>
  <button type="button" on:click={() => stash('unbound')} disabled={!currentFile}>Stash unbound autoAccept File (manual Use required)</button>
  <button type="button" on:click={() => stash('manual')} disabled={!currentFile}>Stash manual File</button>
  <button type="button" on:click={observeStorage}>Observe pending metadata</button>
  <button type="button" on:click={() => gate('loading')}>Set access loading context</button>
  <button type="button" on:click={() => gate('signed-out')}>Set signed-out context</button>
  <p role="status" data-fixture-status>{status}</p>
  {#if !serialized}<p role="alert">Requested tool is absent from the real default registry.</p>{/if}
  {#if mounted && target}
    {#key `${selectedId}:${routingNegative}:${mountAttempt}`}
      <ToolRunner tool={target} preloadedFile={deliveredFile} />
    {/key}
  {/if}
</section>
