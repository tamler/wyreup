<script lang="ts">
  import BankStatementRunner from '../../src/components/runners/BankStatementRunner.svelte';
  import { bankStatementToCsv, type BankDocument, type BankFileJob } from '@wyreup/core';
  const tool = { ...bankStatementToCsv, defaults: { ...bankStatementToCsv.defaults } };
  let mounted = true;
  const pending = new URLSearchParams(location.search).has('pending');
  const minimal: BankDocument = {
    rowTolerance: 2,
    pages: [{ page: 1, width: 600, height: 800, visual: 'blank' }],
    lines: [],
  };
  const injectedExtractor = pending
    ? (_job: BankFileJob, _signal: AbortSignal) =>
        new Promise<BankDocument>((resolve, reject) => {
          (window as unknown as { resolveBank: () => void; rejectBank: () => void }).resolveBank =
            () => resolve(minimal);
          (window as unknown as { resolveBank: () => void; rejectBank: () => void }).rejectBank =
            () => reject(new Error('Stale bank rejection'));
        })
    : undefined;
</script>
<button type="button" on:click={()=>mounted=false}>Unmount bank converter</button>
{#if mounted}<BankStatementRunner {tool} {injectedExtractor}/>{/if}
