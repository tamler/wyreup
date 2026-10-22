<script lang="ts">
  import { planningTools } from '../../../core/src/utilities/planning';
  import { nameTools } from '../../../core/src/utilities/names';
  import TimerRunner from '../../src/components/runners/TimerRunner.svelte';
  import SeatingChartRunner from '../../src/components/runners/SeatingChartRunner.svelte';
  import NamesRunner from '../../src/components/runners/NamesRunner.svelte';
  import RandomRunner from '../../src/components/runners/RandomRunner.svelte';
  import PlanningRowsRunner from '../../src/components/runners/PlanningRowsRunner.svelte';
  import PhotographyContractRunner from '../../src/components/runners/PhotographyContractRunner.svelte';
  import UtilityRunner from '../../src/components/runners/UtilityRunner.svelte';

  const id = new URLSearchParams(window.location.search).get('id') ?? 'stopwatch';
  const tool = [...planningTools, ...nameTools].find(module => module.id === id);
  if (!tool) throw new Error('Unknown planning acceptance fixture.');
  let showRunner = true;
</script>

<button type="button" on:click={() => { showRunner = false; }}>Unmount runner</button>
{#if showRunner}
  {#if ['stopwatch', 'countdown-timer'].includes(id)}
    <TimerRunner {tool} injectedTool={tool} />
  {:else if id === 'wedding-seating-chart-builder'}
    <SeatingChartRunner {tool} injectedTool={tool} />
  {:else if nameTools.some(module => module.id === id)}
    <NamesRunner {tool} injectedTool={tool} />
  {:else if ['random-number-generator', 'dice-roller', 'coin-flip'].includes(id)}
    <RandomRunner {tool} injectedTool={tool} />
  {:else if ['gpa-calculator', 'grade-calculator', 'cocktail-dilution-calculator'].includes(id)}
    <PlanningRowsRunner {tool} injectedTool={tool} />
  {:else if id === 'photography-contract-generator'}
    <PhotographyContractRunner {tool} injectedTool={tool} />
  {:else}
    <UtilityRunner {tool} injectedTool={tool} />
  {/if}
{/if}
