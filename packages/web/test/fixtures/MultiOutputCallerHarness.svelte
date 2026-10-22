<script lang="ts">
  import { onMount } from 'svelte';
  import ChainRunner from '../../src/components/ChainRunner.svelte';
  import ChainBuilder from '../../src/components/ChainBuilder.svelte';
  import BatchFolderRun from '../../src/components/BatchFolderRun.svelte';
  import { createDefaultRegistry, realSplitOutputs } from './mediaCallerCore';
  onMount(() => { Object.assign(window, { realSplitOutputs }); });
  const caller = new URLSearchParams(location.search).get('caller') ?? 'chain';
  const module = createDefaultRegistry().toolsById.get('split-pdf')!;
  const tools = [{ id: module.id, name: module.name, description: module.description, inputAccept: module.input.accept, inputMin: module.input.min, outputMime: module.output.mime, defaults: module.defaults }];
  const resolvedSteps = [{ toolId: module.id, name: module.name, params: { mode: 'all', ranges: '' }, valid: true }];
</script>
{#if caller === 'chain'}<ChainRunner {tools} stepsParam="split-pdf" />
{:else if caller === 'builder'}<ChainBuilder {tools} />
{:else}<BatchFolderRun {resolvedSteps} />{/if}
