<script lang="ts">
  import DateCalculatorRunner from '../../src/components/runners/DateCalculatorRunner.svelte';
  import CompoundInterestRunner from '../../src/components/runners/CompoundInterestRunner.svelte';
  import { dateCalculator } from '../../../core/src/tools/date-calculator';
  import { compoundInterest } from '../../../core/src/tools/compound-interest';
  import type { DateCalculatorParams } from '../../../core/src/tools/date-calculator/types';
  import type { CompoundInterestParams } from '../../../core/src/tools/compound-interest/types';
  import type { ToolRunContext } from '../../../core/src/types';

  const kind = new URLSearchParams(location.search).get('kind') ?? 'date';
  let mounted = true;
  let execution = 'normal';
  let serial = 0;
  const state = window as unknown as {
    finishExtension?: () => void;
    rejectExtension?: () => void;
    extensionCopied: string;
    extensionCopyFailure: boolean;
    extensionAborted: number;
    extensionCreated: string[];
    extensionRevoked: string[];
  };
  Object.assign(state, {
    extensionCopied: '',
    extensionCopyFailure: false,
    extensionAborted: 0,
    extensionCreated: [],
    extensionRevoked: [],
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      async writeText(value: string) {
        await Promise.resolve();
        if (state.extensionCopyFailure) throw new Error('Clipboard denied');
        state.extensionCopied = value;
      },
    },
  });
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    state.extensionCreated.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    state.extensionRevoked.push(url);
    revoke(url);
  };
  async function deferred(ctx: ToolRunContext) {
    if (execution !== 'deferred') return false;
    const own = ++serial;
    const aborted = () => {
      state.extensionAborted++;
    };
    ctx.signal.addEventListener('abort', aborted, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        state.finishExtension = () => {
          if (own === serial) resolve();
        };
        state.rejectExtension = () => {
          if (own === serial) reject(new Error('Stale extension rejection'));
        };
      });
    } finally {
      ctx.signal.removeEventListener('abort', aborted);
    }
    return true;
  }
  const date = {
    ...dateCalculator,
    async run(inputs: File[], params: DateCalculatorParams, ctx: ToolRunContext) {
      const delayed = await deferred(ctx);
      return dateCalculator.run(
        inputs,
        params,
        delayed ? { ...ctx, signal: new AbortController().signal } : ctx,
      );
    },
  };
  const compound = {
    ...compoundInterest,
    async run(inputs: File[], params: CompoundInterestParams, ctx: ToolRunContext) {
      const delayed = await deferred(ctx);
      return compoundInterest.run(
        inputs,
        params,
        delayed ? { ...ctx, signal: new AbortController().signal } : ctx,
      );
    },
  };
</script>

<label for="harness-execution">Harness execution</label><select id="harness-execution" bind:value={execution}><option value="normal">Normal</option><option value="deferred">Deferred</option></select>
<button type="button" on:click={() => { mounted = false; }}>Unmount extension</button>
{#if mounted}
  {#if kind === 'date'}<DateCalculatorRunner tool={date} injectedTool={date} showChain={false} />
  {:else}<CompoundInterestRunner tool={compound} injectedTool={compound} showChain={false} />{/if}
{/if}
