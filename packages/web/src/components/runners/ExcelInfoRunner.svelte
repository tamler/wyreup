<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // excel-info renders as a sheet-tab strip with a 5-row preview table
  // for the active sheet. The raw JSON is still downloadable. Beats a
  // wall-of-text JSON dump for a workbook inspection.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface SheetInfo {
    name: string;
    rows: number;
    cols: number;
    preview: unknown[][];
  }

  interface ExcelResult {
    sheetCount: number;
    sheetNames: string[];
    totalCells: number;
    perSheet: SheetInfo[];
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: ExcelResult | null = null;
  let resultBlob: Blob | null = null;
  let activeSheet = 0;

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= 1 && state !== 'running';
  $: active = result?.perSheet[activeSheet] ?? null;
  $: previewMaxCols = active
    ? Math.max(0, ...active.preview.map((r) => r.length))
    : 0;
  $: hasMoreRows = active ? active.rows > active.preview.length : false;

  function fmtCell(v: unknown): string {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') {
      // Excel encodes dates as serials; we don't have the format string here,
      // so render numbers plainly with reasonable precision.
      return Number.isInteger(v) ? v.toString() : v.toFixed(4).replace(/\.?0+$/, '');
    }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return JSON.stringify(v);
  }

  function colName(idx: number): string {
    let n = idx;
    let out = '';
    while (n >= 0) {
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26) - 1;
    }
    return out;
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    result = null;
    resultBlob = null;
    activeSheet = 0;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);
      const blobs = await toolModule.run(
        files,
        {},
        {
          onProgress: (p) => {
            progress = p;
          },
          signal: new AbortController().signal,
          cache: new Map(),
          executionId: crypto.randomUUID(),
        },
      );
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) throw new Error('No output produced.');
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as ExcelResult;
      activeSheet = 0;
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function reset() {
    state = 'idle';
    errorMsg = '';
    result = null;
    resultBlob = null;
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(files[0]?.name, tool.id, 'json');
    a.click();
  }
</script>

<div class="runner">
  <DropZone
    accept={tool.input.accept}
    multiple={false}
    bind:files
    bind:error={dropError}
    on:files={onFiles}
  />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? `Run ${tool.name} again` : `Run ${tool.name}`}
    </button>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert">
      <div class="panel-header">
        <span class="panel-label error-label">Error</span>
      </div>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" on:click={reset} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && result && active}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Workbook</span>
        </div>
        <div class="panel-divider"></div>

        <div class="stat-grid">
          <div class="stat-cell">
            <span class="stat-label">Sheets</span>
            <span class="stat-val">{result.sheetCount}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">Total cells</span>
            <span class="stat-val">{result.totalCells.toLocaleString()}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">Active sheet</span>
            <span class="stat-val">{active.name}</span>
          </div>
        </div>

        <div class="panel-divider"></div>

        <div class="tab-strip" role="tablist">
          {#each result.perSheet as sheet, i (sheet.name)}
            <button
              type="button"
              role="tab"
              class="tab"
              class:tab--active={i === activeSheet}
              aria-selected={i === activeSheet}
              on:click={() => (activeSheet = i)}
            >
              <span class="tab-name">{sheet.name}</span>
              <span class="tab-meta">{sheet.rows}×{sheet.cols}</span>
            </button>
          {/each}
        </div>

        <div class="sheet-meta">
          <div class="solder-row">
            <span class="solder-key">Rows</span>
            <span class="solder-rule" aria-hidden="true"></span>
            <span class="solder-pad" aria-hidden="true"></span>
            <span class="solder-val">{active.rows.toLocaleString()}</span>
          </div>
          <div class="solder-row">
            <span class="solder-key">Cols</span>
            <span class="solder-rule" aria-hidden="true"></span>
            <span class="solder-pad" aria-hidden="true"></span>
            <span class="solder-val">{active.cols.toLocaleString()}</span>
          </div>
        </div>

        {#if active.preview.length > 0 && previewMaxCols > 0}
          <div class="preview-wrap">
            <table class="preview-table">
              <thead>
                <tr>
                  <th class="row-num"></th>
                  {#each Array(previewMaxCols) as _, c}
                    <th>{colName(c)}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each active.preview as row, r}
                  <tr>
                    <td class="row-num">{r + 1}</td>
                    {#each Array(previewMaxCols) as _, c}
                      <td class:cell--empty={row[c] === null || row[c] === undefined || row[c] === ''}>
                        {fmtCell(row[c])}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if hasMoreRows}
            <p class="preview-note">
              Showing first {active.preview.length} of {active.rows.toLocaleString()} rows.
            </p>
          {/if}
        {:else}
          <p class="preview-note preview-note--empty">Sheet is empty.</p>
        {/if}

        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-secondary" on:click={downloadJson} type="button">
            Download JSON
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .runner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .btn-primary {
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    align-self: flex-start;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-primary:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .btn-primary:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    align-self: flex-start;
  }

  .btn-secondary:hover {
    background: var(--bg-raised);
    border-color: var(--text-muted);
  }

  .error-panel {
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }
  .error-label {
    color: var(--danger);
  }
  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .panel-divider {
    height: 1px;
    background: var(--border-subtle);
  }

  .result-panel {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
  }
  .result-panel__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-3);
  }

  .stat-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .stat-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }
  .stat-val {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-strip {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    font-family: var(--font-mono);
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .tab:hover {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .tab--active {
    background: var(--bg-elevated);
    border-color: var(--border);
    color: var(--text-primary);
  }

  .tab-name {
    font-size: var(--text-sm);
    font-weight: 500;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-meta {
    font-size: var(--text-xs);
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }

  .tab--active .tab-meta {
    color: var(--text-muted);
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .sheet-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .solder-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 20px;
  }
  .solder-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 80px;
    flex-shrink: 0;
  }
  .solder-rule {
    flex: 1;
    height: 1px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .solder-pad {
    width: 3px;
    height: 3px;
    background: var(--border);
    flex-shrink: 0;
  }
  .solder-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .preview-wrap {
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
  }

  .preview-table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .preview-table th,
  .preview-table td {
    padding: 6px var(--space-2);
    border-right: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    text-align: left;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-table th {
    background: var(--bg-raised);
    color: var(--text-subtle);
    font-weight: 400;
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    position: sticky;
    top: 0;
  }

  .preview-table td {
    color: var(--text-primary);
  }

  .preview-table .row-num {
    background: var(--bg-raised);
    color: var(--text-subtle);
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 40px;
    min-width: 40px;
  }

  .cell--empty {
    color: var(--text-subtle);
  }

  .preview-note {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin: 0;
  }

  .preview-note--empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .result-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .brackets::before,
  .brackets::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }
  .brackets::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--accent-hover);
    border-left: 1px solid var(--accent-hover);
  }
  .brackets::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }

  .brackets-inner {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .brackets-inner::before,
  .brackets-inner::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }
  .brackets-inner::before {
    top: -5px;
    right: -5px;
    border-top: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }
  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }
</style>
