<script lang="ts">
  import type { ToolModule, ToolRunContext } from '../../../core/src/types.js';
  import { textDeveloperTools } from '../../../core/src/utilities/text-developer.js';
  import { codeBeautifier } from '../../../core/src/utilities/code-beautifier.js';
  import { numberBaseConverter } from '../../../core/src/tools/number-base-converter/index.js';
  import TextInputRunner from '../../src/components/runners/TextInputRunner.svelte';
  const query = new URLSearchParams(location.search);
  const base: ToolModule<Record<string, unknown>> = query.get('id') === 'code-beautifier' ? codeBeautifier : query.get('id') === 'number-base-converter' ? {
    ...numberBaseConverter, defaults: { ...numberBaseConverter.defaults },
    run: (inputs, params, ctx) => numberBaseConverter.run(inputs, params, ctx),
  } : textDeveloperTools.find((value) => value.id === (query.get('id') ?? 'markdown-table-generator'))!;
  if (!base) throw new Error('Actual manual text tool unavailable.');
  const tool = { ...base };
  const probe = { reads: 0, releasePreload: () => {}, pending: [] as { ctx: ToolRunContext; release: () => void }[] };
  Object.assign(window, { manualTextProbe: probe });
  const preload = query.get('preload');
  const preloadedFile = preload ? new File([preload === 'oversize' ? 'x'.repeat(base.input.sizeLimit! + 1) : 'original\noriginal\n'], 'original.txt', { type: 'text/plain' }) : null;
  if (preloadedFile) {
    const read = preloadedFile.text.bind(preloadedFile);
    preloadedFile.text = async () => {
      probe.reads++;
      const text = await read();
      if (preload === 'delayed') await new Promise<void>((resolve) => { probe.releasePreload = resolve; });
      return text;
    };
  }
  const injectedTool: ToolModule<Record<string, unknown>> = { ...base, async run(inputs, params, ctx) {
    const result = await base.run(inputs, params, ctx);
    if (query.has('deferred')) await new Promise<void>((resolve) => { probe.pending.push({ ctx, release: resolve }); });
    if (query.has('error')) throw new Error('Controlled manual text transport failure.');
    return result;
  } };
  let mounted = true;
</script>
<button type="button" on:click={() => mounted = false}>Unmount manual text runner</button>
{#if mounted}<TextInputRunner {tool} {preloadedFile} {injectedTool} showChain={false} />{/if}
