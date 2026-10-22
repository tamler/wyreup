<script lang="ts">
  import { onDestroy } from 'svelte';
import {
    bankDefaults,
    exportBankStatement,
    reviewBankStatement,
    runBankFileJob,
    validateBankParams,
    type BankDocument,
    type BankFileJob,
    type BankParams,
    type BankReview,
    type BankLineDecision,
  } from '@wyreup/core/execution';
  import DropZone from './DropZone.svelte';
  import type { PreloadAdmission, SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedExtractor:
    ((job: BankFileJob, signal: AbortSignal) => Promise<BankDocument>) | undefined = undefined;
  let files: File[] = [];
  let params: BankParams = structuredClone(bankDefaults);
  const fields = ['date', 'description', 'amount', 'debit', 'credit', 'balance'] as const;
  type Field = (typeof fields)[number];
  let boundaries: Record<Field, { start: string; end: string }> = {
    date: { start: '35', end: '115' },
    description: { start: '115', end: '350' },
    amount: { start: '350', end: '430' },
    debit: { start: '350', end: '390' },
    credit: { start: '390', end: '430' },
    balance: { start: '430', end: '510' },
  };
  let mode: 'signed-amount' | 'debit-credit' = 'signed-amount';
  let useBalance = true;
  let opening = '';
  let closing = '';
  let year = '';
  let document: BankDocument | null = null;
  let preview: BankReview | null = null;
  let reviewed: BankReview | null = null;
  let error = '';
  let notice = '';
  let running = false;
  let generation = 0;
  let controller: AbortController | null = null;
  let pageIndex = 0;
  let editor: string | null = null;
  let draft = { date: '', description: '', amount: '', balance: '' };
  const urls = new Set<string>();
  let destroyed = false;
  let observedPreload: File | null = null;
  let operationFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function report(file: File | null, status: 'admitted' | 'refused') {
    if (!destroyed && file && file === preloadedFile && files[0] === file)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'PDF interpretation did not complete.' });
  }
  function stagePreload(file: File | null) {
    observedPreload = file;
    filesChanged(new CustomEvent<File[]>('files', { detail: [] }));
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); files = [file]; }
  }
  function mappingFields(layout: typeof mode, withBalance: boolean) {
    return fields.filter(
      (field) =>
        field === 'date' ||
        field === 'description' ||
        (field === 'balance' && withBalance) ||
        (layout === 'signed-amount' ? field === 'amount' : field === 'debit' || field === 'credit'),
    );
  }
  $: activeFields = mappingFields(mode, useBalance);
  $: rows = reviewed?.rows ?? preview?.rows ?? [];
  $: pageCount = Math.max(1, Math.ceil(rows.length / 50));
  $: visibleRows = rows.slice(pageIndex * 50, (pageIndex + 1) * 50);

  function clearUrls() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  }
  function cancel() {
    if (running) report(operationFile, 'refused');
    generation++;
    controller?.abort();
    controller = null;
    running = false;
    operationFile = null;
  }
  function readParams(): BankParams {
    const ranges = Object.fromEntries(
      mappingFields(mode, useBalance).map((field) => {
        const b = boundaries[field];
        if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(b.start) || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(b.end))
          throw new Error('Column boundaries require explicit decimal PDF points.');
        return [field, [Number(b.start), Number(b.end)]];
      }),
    );
    if (year && !/^\d{4}$/.test(year)) throw new Error('Statement year requires four digits.');
    return validateBankParams({
      ...params,
      mapping: { mode, ...ranges },
      opening: opening || null,
      closing: closing || null,
      statementYear: year ? Number(year) : null,
    });
  }
  function refresh() {
    reviewed = null;
    preview = null;
    error = '';
    notice = '';
    clearUrls();
    if (!document) return;
    try {
      const current = readParams();
      preview = reviewBankStatement(document, {
        ...current,
        lineDecisions: current.lineDecisions.map((d) => ({ ...d, decision: 'pending' })),
      });
      reviewed = reviewBankStatement(document, current);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Statement review failed.';
    }
  }
  function changed(resetDecisions = false) {
    cancel();
    params = {
      ...params,
      acknowledged: false,
      ...(resetDecisions
        ? { lineDecisions: params.lineDecisions.map((d) => ({ ...d, decision: 'pending' as const })) }
        : {}),
    };
    refresh();
  }
  function toleranceChanged() {
    cancel();
    document = null;
    preview = null;
    reviewed = null;
    editor = null;
    params = { ...params, lineDecisions: [], pageDecisions: [], acknowledged: false };
    clearUrls();
    error = '';
    notice = 'Row tolerance changed. Extract the PDF again.';
  }
  function filesChanged(event: CustomEvent<File[]>) {
    cancel();
    clearUrls();
    files = event.detail;
    document = null;
    preview = null;
    reviewed = null;
    editor = null;
    error = '';
    notice = '';
    params = { ...params, lineDecisions: [], pageDecisions: [], acknowledged: false };
  }
  async function extract() {
    cancel();
    clearUrls();
    error = '';
    notice = '';
    const ownGeneration = generation;
    const ownController = new AbortController();
    const ownFile = files[0] ?? null, ownTool = tool;
    operationFile = ownFile;
    controller = ownController;
    running = true;
    try {
      if (files.length !== 1 || !ownFile || !ownFile.size || ownFile.size > 20 * 1024 * 1024)
        throw new Error('Select one nonempty PDF of at most 20 MiB.');
      const bytes = new Uint8Array(await ownFile.arrayBuffer());
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      const parsed = await (injectedExtractor ?? runBankFileJob)(
        { type: 'bank-extract', bytes, params: { rowTolerance: params.rowTolerance } },
        ownController.signal,
      );
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      document = parsed;
      params = {
        ...params,
        lineDecisions: parsed.lines.map((line) => ({
          id: line.id,
          decision: 'pending',
          role: 'transaction',
        })),
        pageDecisions: [],
        acknowledged: false,
      };
      pageIndex = 0;
      editor = null;
      refresh();
      report(ownFile, error ? 'refused' : 'admitted');
    } catch (cause) {
      if (!destroyed && ownGeneration === generation && ownTool === tool) {
        error = cause instanceof Error ? cause.message : 'PDF extraction failed.';
        report(ownFile, 'refused');
      }
    } finally {
      if (!destroyed && ownGeneration === generation && ownTool === tool) {
        running = false;
        controller = null;
        operationFile = null;
      }
    }
  }
  function decision(id: string): BankLineDecision {
    return params.lineDecisions.find((d) => d.id === id)!;
  }
  function updateDecision(
    id: string,
    key: 'decision' | 'role' | 'reason' | 'attachTo',
    value: string,
  ) {
    params = {
      ...params,
      lineDecisions: params.lineDecisions.map((d) => (d.id === id ? { ...d, [key]: value } : d)),
      acknowledged: false,
    };
    refresh();
  }
  function updatePage(page: number, key: 'decision' | 'reason', value: string) {
    const existing = params.pageDecisions.find((d) => d.page === page) ?? {
      page,
      decision: 'pending' as const,
      reason: '',
    };
    params = {
      ...params,
      pageDecisions: [
        ...params.pageDecisions.filter((d) => d.page !== page),
        { ...existing, [key]: value },
      ],
      acknowledged: false,
    };
    refresh();
  }
  function startEdit(id: string) {
    const row = rows.find((r) => r.id === id)!;
    const edits = decision(id).edited ?? {};
    draft = {
      date: edits.date ?? row.raw.date,
      description: edits.description ?? row.raw.description,
      amount: edits.amount ?? row.raw.amount,
      balance: edits.balance ?? row.raw.balance,
    };
    editor = id;
    error = '';
  }
  function saveEdit() {
    if (!editor) return;
    try {
      const id = editor;
      const edited = {
        date: draft.date,
        description: draft.description,
        ...(mode === 'signed-amount' ? { amount: draft.amount } : {}),
        balance: draft.balance,
      };
      const next = {
        ...readParams(),
        lineDecisions: params.lineDecisions.map((d) =>
          d.id === id ? { ...d, edited, decision: 'pending' as const } : d,
        ),
        acknowledged: false,
      };
      validateBankParams(next);
      params = next;
      editor = null;
      refresh();
      notice = 'Edited row saved. Review its decision again.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Edit could not be saved.';
    }
  }
  function download() {
    if (!document) return;
    try {
      const csv = exportBankStatement(document, readParams());
      clearUrls();
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      urls.add(url);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = 'bank-statement.csv';
      link.click();
      error = '';
      notice = `Exported ${rows.length} reviewed source rows; ${reviewed?.status ?? ''}.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'CSV export failed.';
    }
  }
  onDestroy(() => {
    destroyed = true;
    cancel();
    clearUrls();
  });
</script>

<div class="bank-statement">
  <p>{tool.description}</p>
  <p>Selectable horizontal text only; no OCR. Amounts use exactly two decimal places in your statement's currency. No currency conversion or inference. Images require review in your original PDF; this is positioned text, not a rendered page.</p>
  <p>Detected annotation text or form values without verified drawing require review and retain exceptions, including unchecked values such as 'Off'. These values are not converted into amounts.</p>
  <p>Some content can be omitted, including unselected listbox labels, rich-text-only notes and viewer-generated stamps. Review every original PDF page; reconciliation does not verify its visual content.</p>
  <p>Annotation review allows at most 1000 annotation records per page, 10000 per document and 1000 strings per projected content array, with a shared 1 MiB per annotation and 10 MiB per document. Duplicate Contents and textContent are both charged toward these limits, including hidden or out-of-crop annotations.</p>
  <p>CSV export retains at most 10 MiB of cell text and produces at most 32 MiB. Descriptions, edits and original-text provenance each count toward the cell limit; a PDF that extracts successfully can still exceed the export limit.</p>
  <DropZone accept={tool.input.accept} sizeLimit={tool.input.sizeLimit} bind:files on:files={filesChanged} />
  <label>Row tolerance (PDF points)<input type="number" min="0.5" max="5" step="0.5" bind:value={params.rowTolerance} on:input={toleranceChanged}/></label>
  <div class="controls"><button type="button" disabled={running} on:click={extract}>Extract PDF text</button>{#if running}<button type="button" on:click={cancel}>Cancel</button>{/if}<button type="button" on:click={()=>filesChanged(new CustomEvent('files',{detail:[]}))}>Clear statement</button></div>
  {#if running}<p role="status">Extracting in an owned local worker.</p>{/if}
  <fieldset><legend>Map source columns in PDF points</legend>
    <label>Amount layout<select bind:value={mode} on:change={()=>changed(true)}><option value="signed-amount">Signed amount</option><option value="debit-credit">Unsigned debit and credit</option></select></label>
    <label><input type="checkbox" bind:checked={useBalance} on:change={()=>changed(true)}/> Map running balances</label>
    <div class="controls">{#each activeFields as field}<label>{field} start<input aria-label={`${field} start`} bind:value={boundaries[field].start} on:input={()=>changed(true)}/></label><label>{field} end<input aria-label={`${field} end`} bind:value={boundaries[field].end} on:input={()=>changed(true)}/></label>{/each}</div>
  </fieldset>
  <fieldset><legend>Statement formats and anchors</legend><div class="controls">
    <label>Date pattern<select bind:value={params.datePattern} on:change={()=>changed(true)}>{#each ['YYYY-MM-DD','DD/MM/YYYY','MM/DD/YYYY','DD/MM','MM/DD'] as format}<option value={format}>{format}</option>{/each}</select></label>
    <label>Year for dates without a year<input bind:value={year} on:input={()=>changed(true)} placeholder="Required for DD/MM or MM/DD"/></label>
    <label>Decimal separator<select bind:value={params.decimal} on:change={()=>changed(true)}><option value="dot">Dot</option><option value="comma">Comma</option></select></label>
    <label>Grouping separator<select bind:value={params.grouping} on:change={()=>changed(true)}>{#each ['none','comma','dot','space'] as value}<option {value}>{value}</option>{/each}</select></label>
    <label>Sign convention<select bind:value={params.signConvention} on:change={()=>changed(true)}>{#each ['minus','parentheses','cr-dr'] as value}<option {value}>{value}</option>{/each}</select></label>
    <label>CR polarity<select bind:value={params.crMeaning} on:change={()=>changed(true)}><option value="positive">Positive</option><option value="negative">Negative</option></select></label>
    <label>Opening balance<input bind:value={opening} on:input={()=>changed()}/></label><label>Closing balance<input bind:value={closing} on:input={()=>changed()}/></label>
  </div></fieldset>
  {#if mode==='debit-credit'}<p>Debit and credit are unsigned magnitudes; net amount is credit minus debit once. To correct source amounts, adjust mapping or use signed mode. Net amount editing is unavailable here.</p>{/if}
  {#if document}
    <p>{document.pages.length} pages and {document.lines.length} source lines. Every line starts pending; no headers or movements are automatically excluded.</p>
    {#each document.pages as sourcePage}<div class="page-review"><p>Page {sourcePage.page}: {sourcePage.visual}; {sourcePage.width} × {sourcePage.height} PDF points.</p>
      {#if ['nontext','mixed','unknown'].includes(sourcePage.visual)}
        <p>Review the original page outside this tool. Visual content is not converted or verified by reconciliation. Reviewed mixed pages can reconcile extracted amounts; excluded, nontext and unknown pages retain exceptions.</p>
        <label>Page {sourcePage.page} decision<select aria-label={`Page ${sourcePage.page} decision`} value={params.pageDecisions.find(d=>d.page===sourcePage.page)?.decision??'pending'} on:change={e=>updatePage(sourcePage.page,'decision',e.currentTarget.value)}><option value="pending">Pending</option><option value="include">Reviewed visual content</option><option value="ignore">Exclude page</option></select></label>
        <label>Page {sourcePage.page} review reason<input maxlength="500" value={params.pageDecisions.find(d=>d.page===sourcePage.page)?.reason??''} on:input={e=>updatePage(sourcePage.page,'reason',e.currentTarget.value)}/></label>
      {/if}
    </div>{/each}
    <p role="status">{reviewed?.status??'Review requires corrections'}; delta {reviewed?.delta??'unavailable'}; accepted transaction sum {reviewed?.acceptedSum??'unavailable'}.</p>
    {#each reviewed?.issues??[] as issue}<p>{issue}</p>{/each}
    <div class="table-wrap"><table><thead><tr><th>Source</th><th>Original positioned text</th><th>Mapped values</th><th>Role and decision</th><th>Review details</th></tr></thead><tbody>
      {#each visibleRows as row(row.id)}<tr><th scope="row">{row.id}<small> y={document.lines.find(l=>l.id===row.id)?.y}</small></th><td><pre>{row.originalText}</pre><details><summary>Text item coordinates</summary>{#each document.lines.find(l=>l.id===row.id)?.items??[] as item}<p>x {item.x} to {item.x+item.width}: {item.text}</p>{/each}</details></td><td><p>{row.date} {row.description}</p><p>Amount: {row.amount||'(none)'}; debit: {row.debit||'(none)'}; credit: {row.credit||'(none)'}; balance: {row.balance||'(none)'}</p>{#each row.errors as issue}<p>{issue}</p>{/each}</td><td>
        <label>Role {row.id}<select aria-label={`Role ${row.id}`} value={decision(row.id).role} on:change={e=>updateDecision(row.id,'role',e.currentTarget.value)}>{#each ['transaction','opening','closing','non-financial'] as value}<option {value}>{value}</option>{/each}</select></label>
        <label>Decision {row.id}<select aria-label={`Decision ${row.id}`} value={decision(row.id).decision} on:change={e=>updateDecision(row.id,'decision',e.currentTarget.value)}>{#each ['pending','accept','ignore','attach'] as value}<option {value}>{value}</option>{/each}</select></label>
      </td><td><label>Reason {row.id}<input maxlength="500" value={decision(row.id).reason??''} on:input={e=>updateDecision(row.id,'reason',e.currentTarget.value)}/></label>
        {#if decision(row.id).decision==='attach'}<label>Attach {row.id} to prior transaction<select aria-label={`Attach ${row.id} to prior transaction`} value={decision(row.id).attachTo??''} on:change={e=>updateDecision(row.id,'attachTo',e.currentTarget.value)}><option value="">Choose target</option>{#each params.lineDecisions.slice(0,params.lineDecisions.findIndex(d=>d.id===row.id)).filter(d=>d.decision==='accept'&&d.role==='transaction') as target}<option value={target.id}>{target.id}</option>{/each}</select></label>{/if}
        <button type="button" on:click={()=>startEdit(row.id)}>Edit {row.id}</button>
      </td></tr>{/each}
    </tbody></table></div>
    <div class="controls"><button type="button" disabled={pageIndex===0} on:click={()=>pageIndex--}>Previous rows</button><p>Page {pageIndex+1} of {pageCount}</p><button type="button" disabled={pageIndex+1>=pageCount} on:click={()=>pageIndex++}>Next rows</button></div>
    {#if editor}<fieldset><legend>Edit {editor}; use the selected source formats</legend><label>Edited date<input bind:value={draft.date}/></label><label>Edited description<textarea bind:value={draft.description} rows="3"></textarea></label>{#if mode==='signed-amount'}<label>Edited amount<input bind:value={draft.amount}/></label>{/if}<label>Edited balance<input bind:value={draft.balance}/></label><div class="controls"><button type="button" on:click={saveEdit}>Save row edit</button><button type="button" on:click={()=>editor=null}>Cancel row edit</button></div></fieldset>{/if}
    <label><input type="checkbox" bind:checked={params.spreadsheetSafe} on:change={()=>{clearUrls();}}/> Spreadsheet-safe text</label>{#if params.spreadsheetSafe}<p>Formula-leading fields gain an apostrophe. Signed numeric cells can become spreadsheet text; raw export preserves decimal strings.</p>{/if}
    <label><input type="checkbox" bind:checked={params.acknowledged} on:change={()=>{clearUrls();}}/> I reviewed every candidate and visual-page exception</label>
    <button type="button" disabled={!reviewed||reviewed.pending>0||!params.acknowledged} on:click={download}>Download reviewed CSV</button>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .bank-statement {display:grid;gap:var(--space-3)}
  .controls {display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:end}
  label {display:grid;gap:var(--space-1)}
  input,select,textarea,button {font:inherit;color:var(--text-primary);background:var(--bg-raised);border:1px solid var(--border);padding:var(--space-2);border-radius:var(--radius-sm)}
  fieldset {border:1px solid var(--border);padding:var(--space-3)}
  .table-wrap {overflow:auto;max-width:100%}
  table {border-collapse:collapse;text-align:left} th,td {border:1px solid var(--border);padding:var(--space-2);vertical-align:top;min-width:9rem}
  pre {white-space:pre-wrap;overflow-wrap:anywhere;max-width:22rem} small {display:block}
  button {cursor:pointer} button:disabled {opacity:.6;cursor:default}
  :is(button,input,select,textarea):focus-visible {outline:2px solid var(--accent-text);outline-offset:2px}
</style>
