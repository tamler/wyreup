<script lang="ts">
  import { stlToGcode } from '@wyreup/core';
  import StlContourRunner from '../../src/components/runners/StlContourRunner.svelte';
  let mounted = true;
  const tool = { ...stlToGcode, defaults: { ...stlToGcode.defaults, layerHeightMm: 2 } };
</script>
<button type="button" on:click={() => { mounted = false; }}>Unmount runner</button>
{#if mounted}<StlContourRunner {tool} />{/if}
