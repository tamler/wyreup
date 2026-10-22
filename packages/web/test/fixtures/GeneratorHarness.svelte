<script lang="ts">
  import { textDeveloperTools } from '../../../core/src/utilities/text-developer.js';
  import GeneratorRunner from '../../src/components/runners/GeneratorRunner.svelte';
  const query = new URLSearchParams(location.search);
  const module = textDeveloperTools.find((value) => value.id === (query.get('id') ?? 'robots-txt-generator'));
  if (!module) throw new Error('Actual generator module missing.');
  const tool = { ...module };
  // A delayed transport around the actual generator proves lifecycle guards;
  // output always comes from that module rather than an invented payload.
  const injectedTool = query.has('delay') ? { ...module, async run(...args: Parameters<typeof module.run>) {
    const output = await module.run(...args);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    if (query.has('error')) throw new Error('Controlled delayed transport error.');
    return output;
  } } : module;
  let mounted = true;
</script>
<button type="button" on:click={() => mounted = false}>Unmount runner</button>
{#if mounted}<GeneratorRunner {tool} {injectedTool} />{/if}
