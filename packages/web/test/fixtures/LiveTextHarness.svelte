<script lang="ts">
  import type { ToolModule } from '@wyreup/core';
  import LiveTextRunner from '../../src/components/runners/LiveTextRunner.svelte';
  import TextInputRunner from '../../src/components/runners/TextInputRunner.svelte';
  import SubnetResults from '../../src/components/runners/SubnetResults.svelte';
  import type { SerializedTool } from '../../src/components/runners/types';
  import { wordCounter } from '../../../core/src/tools/word-counter/index.js';
  import { jsonFormatter } from '../../../core/src/tools/json-formatter/index.js';
  import { jsonPath } from '../../../core/src/tools/json-path/index.js';
  import { markdownToHtml } from '../../../core/src/tools/markdown-to-html/index.js';
  import { numberBaseConverter } from '../../../core/src/tools/number-base-converter/index.js';
  import { textDeveloperTools } from '../../../core/src/utilities/text-developer.js';
  import { splitIpv4Subnet } from '../../../core/src/tools/ip-subnet-calc/index.js';
  const query = new URLSearchParams(window.location.search);
  const id = query.get('tool') ?? 'word-counter';
  const available = [wordCounter, jsonFormatter, jsonPath, markdownToHtml, numberBaseConverter, ...textDeveloperTools];
  const selected = available.find(module => module.id === id);
  if (!selected && id !== 'subnets') throw new Error('Unknown acceptance tool.');
  const module = selected ? { ...selected, defaults: { ...selected.defaults } } as ToolModule<Record<string, unknown>> : null;
  const tool: SerializedTool | null = module ? { ...module, defaults: { ...module.defaults }, memoryEstimate: module.memoryEstimate ?? 'low' } : null;
  let shown = true;
  const deferred = query.get('deferred') === '1';
  const preloadProbe = { reads: 0, textReadSizes: [] as number[], bufferReadSizes: [] as number[], slices: [] as (number | undefined)[] };
  const preload = query.get('preload');
  const preloadedFile = preload === 'oversize' ? new File(['x'.repeat(1024 * 1024 + 1)], 'large.txt', { type: 'text/plain' }) : preload === 'read-error' ? new File(['original'], 'unreadable.txt', { type: 'text/plain' }) : preload === 'invalid-utf8' ? new File([new Uint8Array([0x61, 0xff, 0x62])], 'invalid.txt', { type: 'text/plain' }) : preload === 'understated' ? new File(['x'.repeat(2 * 1024 * 1024)], 'understated.txt', { type: 'text/plain' }) : preload === 'valid' ? new File(['Café 中文'], 'unicode.txt', { type: 'text/plain' }) : null;
  if (preloadedFile) {
    const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
    function observe(blob: Blob) {
      const read = blob.text.bind(blob), buffer = blob.arrayBuffer.bind(blob), slice = blob.slice.bind(blob);
      blob.text = () => { preloadProbe.reads++; preloadProbe.textReadSizes.push(size.call(blob) as number); return preload === 'read-error' ? Promise.reject(new Error('Controlled live file read failure.')) : read(); };
      blob.arrayBuffer = () => { preloadProbe.reads++; preloadProbe.bufferReadSizes.push(size.call(blob) as number); return preload === 'read-error' ? Promise.reject(new Error('Controlled live file read failure.')) : buffer(); };
      blob.slice = (start, end, type) => { preloadProbe.slices.push(end); const part = slice(start, end, type); observe(part); return part; };
    }
    observe(preloadedFile);
    if (preload === 'understated') Object.defineProperty(preloadedFile, 'size', { value: 1 });
  }
  const pending: { resolve: (value: Blob[]) => void; reject: (value: Error) => void; ctx: Parameters<ToolModule<Record<string, unknown>>['run']>[2] }[] = [];
  const injected: ToolModule<Record<string, unknown>> | undefined = module ? deferred ? { ...module, run: (_files, _params, ctx) => new Promise((resolve, reject) => { pending.push({ resolve, reject, ctx }); }) } : module : undefined;
  Object.assign(window, { textFixture: {
    preloadProbe,
    pending,
    release(index: number, outcome: string) { const item = pending[index]; item.ctx.onProgress({ stage: 'processing', message: 'stale progress' }); if (outcome === 'error') item.reject(new Error('stale error')); else item.resolve([new Blob(['{"actual":true}'], { type: 'application/json' })]); },
  } });
</script>
<button type="button" on:click={() => shown = false}>Unmount runner</button>
{#if shown}
  {#if id === 'subnets'}<SubnetResults json={JSON.stringify(splitIpv4Subnet('10.0.0.0/8', 20), null, 2)} />
  {:else if tool}
    {#if query.get('manual') === '1'}<TextInputRunner {tool} injectedTool={injected} showChain={false} />
    {:else}<LiveTextRunner {tool} {preloadedFile} injectedTool={injected} showChain={false} />{/if}
  {/if}
{/if}
