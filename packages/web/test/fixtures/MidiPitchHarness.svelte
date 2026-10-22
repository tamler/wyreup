<script lang="ts">
  import MidiPitchRunner from '../../src/components/runners/MidiPitchRunner.svelte';
  import { mp3ToMidi } from '../../../core/src/utilities/mp3-to-midi';
  import type { SerializedTool } from '../../src/components/runners/types';
  const tool: SerializedTool = { ...mp3ToMidi, memoryEstimate: 'high' };
  let shown = true;
</script>
<button type="button" on:click={() => shown = false}>Unmount runner</button>
{#if shown}<MidiPitchRunner {tool} />{/if}
