<script lang="ts">
  import TextResultRunner from '../../src/components/runners/TextResultRunner.svelte';
  import { base64 } from '../../../core/src/tools/base64';
  import { csvJson } from '../../../core/src/tools/csv-json';
  import type { ToolModule, ToolRunContext } from '../../../core/src/types';

  const actual = new URLSearchParams(location.search).get('kind') === 'csv' ? csvJson : base64;
  let mounted = true;
  let execution = 'normal';
  const state = window as unknown as {
    textFinish?: () => void;
    textReject?: () => void;
    textCopied: string;
    textCopyFailure: boolean;
    textAborted: number;
    textCreated: string[];
    textRevoked: string[];
    textReads: number[];
  };
  Object.assign(state, { textCopied: '', textCopyFailure: false, textAborted: 0, textCreated: [], textRevoked: [], textReads: [] });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    async writeText(value: string) {
      await Promise.resolve();
      if (state.textCopyFailure) throw new Error('Clipboard denied');
      state.textCopied = value;
    },
  } });
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = create(blob); state.textCreated.push(url); return url; };
  URL.revokeObjectURL = (url) => { state.textRevoked.push(url); revoke(url); };
  const read = Blob.prototype.text;
  Blob.prototype.text = function () { state.textReads.push(this.size); return read.call(this); };
  const injectedTool: ToolModule<Record<string, unknown>> = {
    ...actual,
    defaults: actual.defaults as unknown as Record<string, unknown>,
    async run(inputs: File[], params: Record<string, unknown>, ctx: ToolRunContext) {
      if (execution === 'deferred') {
        const aborted = () => { state.textAborted++; };
        ctx.signal.addEventListener('abort', aborted, { once: true });
        try {
          await new Promise<void>((resolve, reject) => {
            state.textFinish = resolve;
            state.textReject = () => reject(new Error('Stale text rejection'));
          });
        } finally { ctx.signal.removeEventListener('abort', aborted); }
        // Exercise an engine that completes despite cancellation; production runner must guard it.
        ctx = { ...ctx, signal: new AbortController().signal };
      }
      return actual.run(inputs, params as never, ctx);
    },
  };
  const tool = { ...actual, slug: actual.id, defaults: injectedTool.defaults };
</script>

<label for="text-execution">Execution</label>
<select id="text-execution" bind:value={execution}><option value="normal">Normal</option><option value="deferred">Deferred</option></select>
<button type="button" on:click={() => { mounted = false; }}>Unmount text runner</button>
{#if mounted}<TextResultRunner {tool} {injectedTool} showChain={false} />{/if}
