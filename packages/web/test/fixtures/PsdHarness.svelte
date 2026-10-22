<script lang="ts">
  import { psdToPng } from '../../../core/src/utilities/files';
  import PsdPngRunner from '../../src/components/runners/PsdPngRunner.svelte';
  let mounted = true;
</script>
<button type="button" on:click={() => { mounted = false; }}>Unmount PSD converter</button>
{#if mounted}<PsdPngRunner tool={psdToPng} injectedTool={psdToPng} />{/if}
