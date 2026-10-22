<script lang="ts">
  import DropZone from '../../src/components/runners/DropZone.svelte';
  import { csvViewer } from '../../../core/src/utilities/files';
  import { parseCsv } from '../../../core/src/utilities/csv-data';
  let selected: File[] = [];
  let parsed = '';
  let error = '';
  async function chosen(files: File[]) {
    selected = files;
    parsed = '';
    error = '';
    if (!files.length) return;
    try {
      const table = parseCsv(new Uint8Array(await files[0]!.arrayBuffer()), { delimiter: 'auto', hasHeader: true });
      parsed = JSON.stringify(table.rows.map(row => row.cells));
    } catch (reason) { error = reason instanceof Error ? reason.message : 'CSV refused'; }
  }
</script>

<DropZone accept={csvViewer.input.accept} label="Select CSV sample" on:files={(event) => { void chosen(event.detail); }} />
<output aria-label="Selected CSV files">{selected.map(file => file.name).join(', ')}</output>
<output aria-label="Parsed CSV cells">{parsed}</output>
<output aria-label="CSV parser error">{error}</output>
