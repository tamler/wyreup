<script lang="ts">
  import { buildingTools } from '../../../core/src/utilities/building';
  import { hardwareTools } from '../../../core/src/utilities/hardware';
  import type { ToolModule } from '../../../core/src/types';
  import BuildingRowsRunner from '../../src/components/runners/BuildingRowsRunner.svelte';
  import ConstructionEstimateRunner from '../../src/components/runners/ConstructionEstimateRunner.svelte';
  import GamepadRunner from '../../src/components/runners/GamepadRunner.svelte';
  import TouchscreenRunner from '../../src/components/runners/TouchscreenRunner.svelte';
  const search = new URLSearchParams(window.location.search);
  const id = search.get('id') ?? 'board-foot-calculator';
  const tool = [...buildingTools, ...hardwareTools].find(candidate => candidate.id === id);
  if (!tool) throw new Error('Unknown building/hardware fixture.');
  const probe = { calls: 0, aborted: 0, resolve: () => {}, reject: () => {} };
  Object.assign(window, { buildingProbe: probe });
  const injectedTool: ToolModule<Record<string, unknown>> = {
    ...tool,
    async run(files, params, ctx) {
      probe.calls++;
      ctx.signal?.addEventListener('abort', () => { probe.aborted++; }, { once: true });
      if (search.has('defer')) await new Promise<void>((resolve, reject) => {
        probe.resolve = resolve; probe.reject = () => reject(new Error('Late actual-tool wrapper rejection.'));
      });
      return tool.run(files, params, ctx);
    },
  };
  let mounted = true;
</script>
<button type="button" on:click={() => { mounted = false; }}>Unmount runner</button>
{#if mounted}
  {#if id === 'construction-estimate-generator'}
    <ConstructionEstimateRunner {tool} {injectedTool}/>
  {:else if id === 'gamepad-tester'}
    <GamepadRunner {tool} {injectedTool}/>
  {:else if id === 'touchscreen-dead-zone-tester'}
    <TouchscreenRunner {tool} {injectedTool}/>
  {:else}
    <BuildingRowsRunner {tool} {injectedTool}/>
  {/if}
{/if}
