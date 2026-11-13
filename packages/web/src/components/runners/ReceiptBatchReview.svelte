<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { parseReceiptBatch, receiptBatchCsv, ReceiptFieldError, type ReceiptBatch, type ReceiptLine } from '../../../../core/src/lib/receipt-batch.js';

  export let initial: unknown;
  let prior: unknown;
  let draft: ReceiptBatch | null = null;
  let error = '';
  let invalidKey = '';
  let blankInvalidLine = '';
  let statusMessage = '';
  let removedLine: { receiptIndex: number; lineIndex: number; line: ReceiptLine } | null = null;
  let section: HTMLElement;
  const errorId = `receipt-error-${crypto.randomUUID()}`;
  const numberHelpId = `receipt-number-help-${crypto.randomUUID()}`;
  const urls = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  $: if (initial !== prior) {
    prior = initial;
    try { draft = parseReceiptBatch(initial); error = ''; invalidKey = ''; blankInvalidLine = ''; statusMessage = ''; removedLine = null; }
    catch { draft = null; error = 'The receipt result is invalid.'; invalidKey = ''; blankInvalidLine = ''; statusMessage = ''; removedLine = null; }
  }

  const fields = ['merchant', 'date', 'currency', 'subtotal', 'tax', 'total'] as const;
  const lineFields = ['description', 'quantity', 'amount'] as const;

  function changeReceipt(receiptIndex: number, field: typeof fields[number], value: string) {
    if (!draft) return;
    draft.receipts[receiptIndex]![field] = value === '' ? null : value;
    draft = { ...draft };
    if (invalidKey === `${receiptIndex}:receipt:${field}`) { error = ''; invalidKey = ''; blankInvalidLine = ''; }
  }

  function changeLine(receiptIndex: number, lineIndex: number, field: typeof lineFields[number], value: string) {
    if (!draft) return;
    draft.receipts[receiptIndex]!.lines[lineIndex]![field] = value === '' ? null : value;
    draft = { ...draft };
    const lineKey = `${receiptIndex}:line:${lineIndex}`;
    if ((invalidKey === `${lineKey}:${field}` && (blankInvalidLine !== lineKey || value !== '')) || (value !== '' && blankInvalidLine === lineKey)) { error = ''; invalidKey = ''; blankInvalidLine = ''; }
  }

  async function addLine(receiptIndex: number) {
    if (!draft || draft.receipts[receiptIndex]!.lines.length >= (removedLine?.receiptIndex === receiptIndex ? 19 : 20)) return;
    const lines = draft.receipts[receiptIndex]!.lines;
    lines.push({ description: null, quantity: null, amount: null });
    draft = { ...draft };
    statusMessage = `Line ${lines.length} added to receipt ${draft.receipts[receiptIndex]!.sourceIndex + 1}.`;
    await tick();
    section.querySelector<HTMLInputElement>(`[data-field-key="${receiptIndex}:line:${lines.length - 1}:description"]`)?.focus();
  }

  async function removeLine(receiptIndex: number, lineIndex: number) {
    if (!draft || removedLine) return;
    const receipt = draft.receipts[receiptIndex]!;
    const [line] = receipt.lines.splice(lineIndex, 1);
    if (!line) return;
    removedLine = { receiptIndex, lineIndex, line };
    draft = { ...draft };
    if (invalidKey.includes(':line:')) { error = ''; invalidKey = ''; blankInvalidLine = ''; }
    statusMessage = `Receipt ${receipt.sourceIndex + 1} line ${lineIndex + 1} removed. Undo is available; remaining lines have been renumbered.`;
    await tick();
    section.querySelector<HTMLButtonElement>('[data-undo-removal]')?.focus();
  }

  async function undoRemoval() {
    if (!draft || !removedLine) return;
    const { receiptIndex, lineIndex, line } = removedLine;
    const receipt = draft.receipts[receiptIndex]!;
    receipt.lines.splice(Math.min(lineIndex, receipt.lines.length), 0, line);
    removedLine = null;
    draft = { ...draft };
    error = ''; invalidKey = ''; blankInvalidLine = '';
    statusMessage = `Receipt ${receipt.sourceIndex + 1} line ${lineIndex + 1} restored.`;
    await tick();
    section.querySelector<HTMLInputElement>(`[data-field-key="${receiptIndex}:line:${lineIndex}:description"]`)?.focus();
  }

  async function keepRemoval() {
    if (!draft || !removedLine) return;
    const { receiptIndex } = removedLine;
    const sourceIndex = draft.receipts[receiptIndex]!.sourceIndex;
    removedLine = null;
    if (error === 'Undo or keep the line removal before exporting.') error = '';
    statusMessage = `Removal kept for receipt ${sourceIndex + 1}.`;
    await tick();
    section.querySelector<HTMLButtonElement>(`[data-add-receipt="${receiptIndex}"]`)?.focus();
  }

  async function download() {
    if (!draft) return;
    if (removedLine) {
      error = ''; invalidKey = ''; blankInvalidLine = '';
      await tick();
      if (!removedLine) return;
      error = 'Undo or keep the line removal before exporting.';
      await tick();
      section.querySelector<HTMLButtonElement>('[data-undo-removal]')?.focus();
      return;
    }
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
      error = ''; invalidKey = ''; blankInvalidLine = '';
    } catch (cause) {
      const attempted = draft;
      error = ''; invalidKey = ''; blankInvalidLine = '';
      await tick();
      if (!draft || draft !== attempted) return;
      if (cause instanceof ReceiptFieldError) {
        invalidKey = cause.fieldKey;
        const parts = invalidKey.split(':');
        if (cause.code === 'blank_line') blankInvalidLine = parts.slice(0, 3).join(':');
        const receipt = draft.receipts[Number(parts[0])];
        const label = parts[1] === 'line' ? `line ${Number(parts[2]) + 1} ${parts[3]}` : parts[2];
        error = `Receipt ${(receipt?.sourceIndex ?? 0) + 1} ${label}: ${cause.message}`;
        await tick();
        if (draft !== attempted) return;
        section.querySelector<HTMLInputElement>(`[data-field-key="${invalidKey}"]`)?.focus();
      } else {
        error = cause instanceof Error ? cause.message : 'Could not export this receipt.';
      }
    }
  }

  onDestroy(() => {
    for (const timer of timers) clearTimeout(timer);
    for (const url of urls) URL.revokeObjectURL(url);
  });
</script>

<section aria-label="Review receipts" bind:this={section}>
  <p>Review every field against your original receipt before using the export.</p>
  <p id={numberHelpId}>For amounts and quantities, use digits, an optional minus sign and a period. Do not use commas or spaces. Use at most 15 significant digits and 4 decimal places.</p>
  <p role="status">{statusMessage}</p>
  {#if removedLine}
    <button type="button" data-undo-removal on:click={undoRemoval}>Undo line removal</button>
    <button type="button" on:click={keepRemoval}>Keep line removal</button>
  {/if}
  {#if error}<p id={errorId} role="alert">{error}</p>{/if}
  {#if draft}
    {#each draft.receipts as receipt, receiptIndex}
      <fieldset>
        <legend>Receipt {receipt.sourceIndex + 1}</legend>
        {#each fields as field}
          <label>
            Receipt {receipt.sourceIndex + 1} {field}
            <input value={receipt[field] ?? ''} maxlength="2000" data-field-key={`${receiptIndex}:receipt:${field}`} aria-invalid={invalidKey === `${receiptIndex}:receipt:${field}` ? 'true' : undefined} aria-describedby={`${['subtotal', 'tax', 'total'].includes(field) ? numberHelpId : ''} ${invalidKey === `${receiptIndex}:receipt:${field}` ? errorId : ''}`.trim() || undefined} on:input={(event) => changeReceipt(receiptIndex, field, event.currentTarget.value)} />
          </label>
        {/each}
        {#each receipt.lines as line, lineIndex}
          <fieldset>
            <legend>Line {lineIndex + 1}</legend>
            {#each lineFields as field}
              <label>
                Receipt {receipt.sourceIndex + 1} line {lineIndex + 1} {field}
                <input value={line[field] ?? ''} maxlength="2000" data-field-key={`${receiptIndex}:line:${lineIndex}:${field}`} aria-invalid={invalidKey === `${receiptIndex}:line:${lineIndex}:${field}` ? 'true' : undefined} aria-describedby={`${field === 'quantity' || field === 'amount' ? numberHelpId : ''} ${invalidKey === `${receiptIndex}:line:${lineIndex}:${field}` ? errorId : ''}`.trim() || undefined} on:input={(event) => changeLine(receiptIndex, lineIndex, field, event.currentTarget.value)} />
              </label>
            {/each}
            <button type="button" disabled={!!removedLine} on:click={() => removeLine(receiptIndex, lineIndex)}>Remove receipt {receipt.sourceIndex + 1} line {lineIndex + 1}</button>
          </fieldset>
        {/each}
        <p>Maximum 20 lines per receipt.{removedLine?.receiptIndex === receiptIndex ? ' Undo or keep the removal to use the final slot.' : ''}</p>
        <button type="button" data-add-receipt={receiptIndex} disabled={receipt.lines.length >= (removedLine?.receiptIndex === receiptIndex ? 19 : 20)} on:click={() => addLine(receiptIndex)}>Add line to receipt {receipt.sourceIndex + 1}</button>
        <p>Model-reported evidence (unverified)</p>
        <ul>{#each Object.entries(receipt.evidence) as [field, excerpt]}<li>{field}: {excerpt ?? 'Not supplied'}</li>{/each}</ul>
        {#each receipt.warnings as warning}<p>{warning}</p>{/each}
      </fieldset>
    {/each}
    <button type="button" on:click={download}>Download CSV</button>
  {/if}
</section>
