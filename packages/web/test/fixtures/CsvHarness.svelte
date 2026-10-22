<script lang="ts">
  import { csvViewer } from '../../../core/src/utilities/files';
  import { parseCsv } from '../../../core/src/utilities/csv-data';
  import CsvViewerRunner from '../../src/components/runners/CsvViewerRunner.svelte';
  import type { CsvFileJob } from '../../../core/src/utilities/file-job';
  let showRunner = true;
  async function parse(job: CsvFileJob, signal: AbortSignal) {
    const table = parseCsv(job.bytes, job.params, signal);
    if (new URLSearchParams(window.location.search).has('pending')) await new Promise<void>((resolve, reject) => {
      Object.assign(window, { resolveCsv: resolve, rejectCsv: () => reject(new Error('stale CSV failure')) });
    });
    return table;
  }
</script>
<button type="button" on:click={() => { showRunner = false; }}>Unmount CSV viewer</button>
{#if showRunner}
  <CsvViewerRunner tool={csvViewer} injectedParser={parse} />
{/if}
