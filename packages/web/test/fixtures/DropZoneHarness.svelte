<script lang="ts">
  import DropZone from '../../src/components/runners/DropZone.svelte';

  const mode = new URLSearchParams(window.location.search).get('mode') ?? 'suffix';
  const patterns: Record<string, string[]> = {
    suffix: ['.psd'],
    nef: ['.NEF'],
    mime: ['image/jpeg'],
    wildcard: ['image/*'],
    all: ['*/*'],
    star: ['*'],
  };
  let selected: File[] = [];
</script>

<DropZone
  accept={patterns[mode] ?? patterns.suffix}
  label="Select sample"
  on:files={(event) => { selected = event.detail; }}
/>
<output aria-label="Selected files">{selected.map((file) => file.name).join(', ')}</output>
