<script lang="ts">
  import ColorConverterRunner from '../../src/components/runners/ColorConverterRunner.svelte';
  import { colorConverter } from '../../../core/src/tools/color-converter/index';
  import type { SerializedTool } from '../../src/components/runners/types';
  const tool = colorConverter as unknown as SerializedTool;
  const query = new URLSearchParams(location.search);
  const preload = query.get('preload');
  const probe = { reads: 0, runs: 0, pending: [] as { release: () => void; signal: AbortSignal }[] };
  Object.assign(window, { colorFixture: probe });
  const preloadedFile = preload ? new File([preload === 'oversize' ? 'x'.repeat(1025) : '#008000'], 'color.txt', { type: 'text/plain' }) : null;
  if (preloadedFile) {
    const read = preloadedFile.text.bind(preloadedFile);
    preloadedFile.text = () => {
      probe.reads++;
      return preload === 'read-error' ? Promise.reject(new Error('Controlled color file read failure.')) : read();
    };
    const slice = preloadedFile.slice.bind(preloadedFile);
    preloadedFile.slice = (...args) => {
      const blob = slice(...args);
      const readBytes = blob.arrayBuffer.bind(blob);
      blob.arrayBuffer = () => {
        probe.reads++;
        return preload === 'read-error' ? Promise.reject(new Error('Controlled color file read failure.')) : readBytes();
      };
      return blob;
    };
  }
  const injectedTool: typeof colorConverter = { ...colorConverter, async run(inputs, params, ctx) {
    probe.runs++;
    const output = await colorConverter.run(inputs, params, ctx);
    if (query.get('deferred') === '1') await new Promise<void>(release => probe.pending.push({ release, signal: ctx.signal }));
    return output;
  } };
  let visible = true;
</script>
<button type="button" on:click={() => { visible = false; }}>Unmount color runner</button>
{#if visible}<ColorConverterRunner {tool} {preloadedFile} {injectedTool} showChain={false} />{/if}
