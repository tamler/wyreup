<script lang="ts">
  import { onDestroy } from 'svelte';
  import { parseReceiptBatch, receiptBatchCsv, type ReceiptBatch } from '../../../../core/src/lib/receipt-batch.js';

  export let initial: unknown;
  let prior: unknown;
  let draft: ReceiptBatch | null = null;
  let error = '';
  const urls = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  $: if (initial !== prior) {
    prior = initial;
    try { draft = parseReceiptBatch(initial); error = ''; }
    catch { draft = null; error = 'The receipt result is invalid.'; }
  }

  const fields = ['merchant', 'date', 'currency', 'subtotal', 'tax', 'total'] as const;
  const lineFields = ['description', 'quantity', 'amount'] as const;

  function changeReceipt(receiptIndex: number, field: typeof fields[number], value: string) {
    if (!draft) return;
    draft.receipts[receiptIndex]![field] = value === '' ? null : value;
    draft = { ...draft };
    error = '';
  }

  function changeLine(receiptIndex: number, lineIndex: number, field: typeof lineFields[number], value: string) {
    if (!draft) return;
    draft.receipts[receiptIndex]!.lines[lineIndex]![field] = value === '' ? null : value;
    draft = { ...draft };
    error = '';
  }

  function download() {
    if (!draft) return;
    try {
      const csv = receiptBatchCsv(draft);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      urls.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'receipts.csv';
      link.click();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); timers.delete(timer); }, 1000);
      timers.add(timer);
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not export this receipt.';
    }
  }

  onDestroy(() => {
    for (const timer of timers) clearTimeout(timer);
    for (const url of urls) URL.revokeObjectURL(url);
  });
</script>

<section aria-label="Review receipts">
  <p>Review every field against your original receipt before using the export.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if draft}
    {#each draft.receipts as receipt, receiptIndex}
      <fieldset>
        <legend>Receipt {receipt.sourceIndex + 1}</legend>
        {#each fields as field}
          <label>
            Receipt {receipt.sourceIndex + 1} {field}
            <input value={receipt[field] ?? ''} on:input={(event) => changeReceipt(receiptIndex, field, event.currentTarget.value)} />
          </label>
        {/each}
        {#each receipt.lines as line, lineIndex}
          <fieldset>
            <legend>Line {lineIndex + 1}</legend>
            {#each lineFields as field}
              <label>
                Receipt {receipt.sourceIndex + 1} line {lineIndex + 1} {field}
                <input value={line[field] ?? ''} on:input={(event) => changeLine(receiptIndex, lineIndex, field, event.currentTarget.value)} />
              </label>
            {/each}
          </fieldset>
        {/each}
        <p>Model-reported evidence (unverified)</p>
        <ul>{#each Object.entries(receipt.evidence) as [field, excerpt]}<li>{field}: {excerpt ?? 'Not supplied'}</li>{/each}</ul>
        {#each receipt.warnings as warning}<p>{warning}</p>{/each}
      </fieldset>
    {/each}
    <button type="button" on:click={download}>Download CSV</button>
  {/if}
</section>
