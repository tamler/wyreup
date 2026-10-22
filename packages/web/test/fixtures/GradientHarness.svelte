<script lang="ts">
  import { textDeveloperTools } from '../../../core/src/utilities/text-developer.js';
  import GradientPreview from '../../src/components/runners/GradientPreview.svelte';
  const module = textDeveloperTools.find((value) => value.id === 'css-gradient-generator');
  if (!module) throw new Error('Actual gradient module missing.');
  const query = new URLSearchParams(location.search);
  const tool = { ...module };
  // Only transport timing is controlled; every result is computed by the real
  // module. Delayed failures test stale-error guards, not color parsing.
  const injectedTool = query.has('delay') ? { ...module, async run(...args: Parameters<typeof module.run>) {
    const output = await module.run(...args);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    if (query.has('error')) throw new Error('Controlled delayed gradient transport error.');
    return output;
  } } : module;
  let mounted = true;
</script>
<button type="button" on:click={() => mounted = false}>Unmount gradient runner</button>
{#if mounted}<GradientPreview {tool} {injectedTool} />{/if}
