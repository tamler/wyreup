<script lang="ts">
  import ChainSection from '../../src/components/runners/ChainSection.svelte';
  const resultBlob = new Blob(['controlled completed image result'], { type: 'image/png' });
</script>
<ChainSection {resultBlob} resultName="result.png" sourceToolId="bg-remove" />
