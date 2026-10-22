<script lang="ts">
  import { onMount } from 'svelte';
  import ChainSection from '../../src/components/runners/ChainSection.svelte';
  import * as storage from '../../src/components/runners/chainStorage';
  import * as trail from '../../src/components/runners/hopTrail';

  let revision = 0;
  let mounted = true;
  let resultBlob = new Blob(['completed original result'], { type: 'video/mp4' });
  let resultName = 'completed-original.mp4';
  let sourceToolId = 'convert-video';
  function replaceResult() {
    revision++;
    resultBlob = new Blob(['completed replacement result ' + revision], { type: 'video/mp4' });
    resultName = 'completed-replacement-' + revision + '.mp4';
    sourceToolId = 'compress-video';
  }
  onMount(() => { Object.assign(window, { chainLatchProbe: { storage, trail } }); });
</script>

<button on:click={replaceResult}>Replace completed result</button>
<button on:click={() => { mounted = false; }}>Unmount actual chain panel</button>
<output aria-label="Current completed result">{resultName}|{sourceToolId}</output>
<section aria-label="Actual chain panel">
  {#if mounted}<ChainSection {resultBlob} {resultName} {sourceToolId} />{/if}
</section>
