<script lang="ts">
  import { onMount } from 'svelte';
  import FinanceRunner from '../../src/components/runners/FinanceRunner.svelte';
  import { financeTools } from '../../../core/src/utilities/finance.js';
  import type { ToolModule } from '../../../core/src/types.js';
  let selected = 'discount-calculator';
  let execution = 'real';
  let show = true;
  $: base = financeTools.find((item) => item.id === selected)!;
  $: tool = { id: base.id, slug: base.slug, name: base.name, description: base.description, category: base.category, keywords: base.keywords, defaults: base.defaults, paramSchema: base.paramSchema, input: base.input, output: base.output, memoryEstimate: base.memoryEstimate };
  $: injected = { ...base, async run(inputs, params, ctx) {
    ctx.signal.addEventListener('abort', () => { (window as unknown as { financeAborts: number }).financeAborts++; }, { once: true });
    if (execution === 'deferred') return await new Promise<Blob[]>((_resolve, reject) => { Object.assign(window, { rejectFinanceRun: () => reject(new Error('Old finance rejection')) }); });
    return await base.run(inputs, params, ctx);
  } } satisfies ToolModule<Record<string, unknown>>;
  onMount(() => {
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    Object.assign(window, { financeAborts: 0, financeCreatedUrls: [] as string[], financeRevokedUrls: [] as string[], financeCopied: '' });
    URL.createObjectURL = (blob) => { const url = create(blob); (window as unknown as { financeCreatedUrls: string[] }).financeCreatedUrls.push(url); return url; };
    URL.revokeObjectURL = (url) => { (window as unknown as { financeRevokedUrls: string[] }).financeRevokedUrls.push(url); revoke(url); };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text: string) { (window as unknown as { financeCopied: string }).financeCopied = text; } } });
  });
</script>
<label>Harness finance tool <select bind:value={selected}><option value="discount-calculator">Discount</option><option value="loan-calculator">Loan</option><option value="recipe-cost-calculator">Recipe</option><option value="amazon-fba-profit-calculator">Amazon FBA</option></select></label>
<label>Harness execution <select bind:value={execution}><option value="real">Real engine</option><option value="deferred">Deferred rejection</option></select></label>
<button type="button" on:click={() => { show = false; }}>Unmount finance calculator</button>
{#if show}{#key selected}<FinanceRunner {tool} injectedTool={injected} />{/key}{/if}
