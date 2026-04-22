<script lang="ts">
  import ChainSection from './ChainSection.svelte';
  import type { SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  void preloadedFile;

  type Mode = 'diff' | 'add' | 'day-of-week';
  type Unit = 'days' | 'weeks' | 'months' | 'years';

  const MODES: { id: Mode; label: string }[] = [
    { id: 'diff',        label: 'Difference' },
    { id: 'add',         label: 'Add / Subtract' },
    { id: 'day-of-week', label: 'Day of week' },
  ];

  const UNITS: { id: Unit; label: string }[] = [
    { id: 'days',   label: 'Days' },
    { id: 'weeks',  label: 'Weeks' },
    { id: 'months', label: 'Months' },
    { id: 'years',  label: 'Years' },
  ];

  let mode: Mode = 'diff';

  // diff mode
  let diffDate1 = '2026-01-01';
  let diffDate2 = '2026-12-31';

  // add mode
  let addDate1 = '2026-04-17';
  let addAmount = 30;
  let addUnit: Unit = 'days';
  let addDir = 1; // 1 = add, -1 = subtract

  // day-of-week mode
  let dowDate = '2026-04-17';

  interface DateResult {
    valid: boolean;
    mode?: string;
    totalDays?: number;
    breakdown?: { years: number; months: number; days: number };
    formatted?: string;
    result?: string;
    dayName?: string;
    error?: string;
  }

  let result: DateResult | null = null;
  let resultBlob: Blob | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCalc, 80);
  }

  async function runCalc() {
    let params: Record<string, unknown> = { mode };

    if (mode === 'diff') {
      params = { mode, date1: diffDate1, date2: diffDate2 };
    } else if (mode === 'add') {
      params = { mode, date1: addDate1, amount: addAmount * addDir, unit: addUnit };
    } else if (mode === 'day-of-week') {
      params = { mode, date1: dowDate };
    }

    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get('date-calculator');
      if (!toolModule) return;

      const blobs = await toolModule.run([], params, {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) return;
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as DateResult;
    } catch { /* ignore */ }
  }

  scheduleRun();

  $: mode, scheduleRun();
  $: (diffDate1, diffDate2), scheduleRun();
  $: (addDate1, addAmount, addUnit, addDir), scheduleRun();
  $: dowDate, scheduleRun();

  // ISO 8601 secondary display for result date
  function isoDisplay(dateStr: string | undefined): string {
    if (!dateStr) return '';
    return dateStr;
  }
</script>

<div class="runner">
  <!-- Mode chips -->
  <div class="mode-chips" role="group" aria-label="Date calculator mode">
    {#each MODES as m}
      <button
        class="chip"
        class:chip--active={mode === m.id}
        type="button"
        on:click={() => { mode = m.id; }}
      >{m.label}</button>
    {/each}
  </div>

  <div class="calc-layout">
    <!-- Inputs -->
    <div class="inputs-panel">
      {#if mode === 'diff'}
        <div class="question-text">How many days between two dates?</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="diff-date1">Start date</label>
            <input id="diff-date1" class="date-input" type="date" bind:value={diffDate1} on:change={scheduleRun} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="diff-date2">End date</label>
            <input id="diff-date2" class="date-input" type="date" bind:value={diffDate2} on:change={scheduleRun} />
          </div>
        </div>

      {:else if mode === 'add'}
        <div class="question-text">Add or subtract time from a date</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="add-date1">Start date</label>
            <input id="add-date1" class="date-input" type="date" bind:value={addDate1} on:change={scheduleRun} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="add-amount">Amount — <span class="field-value">{addAmount} {addUnit}</span></label>
            <input id="add-amount" class="range-input" type="range" min="1" max="365" step="1" bind:value={addAmount} on:input={scheduleRun} />
            <div class="range-bounds"><span>1</span><span>365</span></div>
          </div>
          <div class="field-inline">
            <span class="field-label">Unit</span>
            <div class="chip-group">
              {#each UNITS as u}
                <button
                  class="unit-chip"
                  class:unit-chip--active={addUnit === u.id}
                  type="button"
                  on:click={() => { addUnit = u.id; scheduleRun(); }}
                >{u.label}</button>
              {/each}
            </div>
          </div>
          <div class="field-inline">
            <span class="field-label">Direction</span>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" name="add-dir" value={1} bind:group={addDir} on:change={scheduleRun} />
                Add
              </label>
              <label class="radio-label">
                <input type="radio" name="add-dir" value={-1} bind:group={addDir} on:change={scheduleRun} />
                Subtract
              </label>
            </div>
          </div>
        </div>

      {:else if mode === 'day-of-week'}
        <div class="question-text">What day of the week is a date?</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="dow-date">Date</label>
            <input id="dow-date" class="date-input" type="date" bind:value={dowDate} on:change={scheduleRun} />
          </div>
        </div>
      {/if}
    </div>

    <!-- Result -->
    <div class="result-col">
      {#if result && result.valid}
        <div class="result-display">
          <span class="result-label">Result</span>

          {#if mode === 'diff' && result.breakdown !== undefined}
            <div class="diff-result">
              <span class="result-value">{Math.abs(result.totalDays ?? 0)}</span>
              <span class="result-unit">days</span>
            </div>
            <div class="breakdown-row">
              <span class="breakdown-item">
                <span class="breakdown-num">{result.breakdown.years}</span>
                <span class="breakdown-lbl">yr</span>
              </span>
              <span class="breakdown-sep">·</span>
              <span class="breakdown-item">
                <span class="breakdown-num">{result.breakdown.months}</span>
                <span class="breakdown-lbl">mo</span>
              </span>
              <span class="breakdown-sep">·</span>
              <span class="breakdown-item">
                <span class="breakdown-num">{result.breakdown.days}</span>
                <span class="breakdown-lbl">d</span>
              </span>
            </div>
            <span class="result-secondary">
              {result.totalDays !== undefined && result.totalDays < 0 ? 'End date is before start date' : ''}
            </span>

          {:else if mode === 'add' && result.result}
            <span class="result-value result-value--date">{result.result}</span>
            <span class="result-secondary mono">ISO 8601: {isoDisplay(result.result)}</span>

          {:else if mode === 'day-of-week' && result.dayName}
            <span class="result-value">{result.dayName}</span>
            <span class="result-secondary mono">ISO 8601: {dowDate}</span>
          {/if}
        </div>
      {:else if result && !result.valid}
        <div class="error-panel" role="alert">
          <span class="panel-label error-label">Error</span>
          <div class="panel-divider"></div>
          <p class="error-msg">{result.error ?? 'Unknown error'}</p>
        </div>
      {/if}

      {#if resultBlob}
        <ChainSection {resultBlob} resultName="date-calculator-result.json" />
      {/if}
    </div>
  </div>
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

  /* Mode chips */
  .mode-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }
  .chip:hover { border-color: var(--accent); color: var(--text-primary); }
  .chip--active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--black);
    font-weight: 500;
  }
  .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Layout */
  .calc-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-6);
    align-items: start;
  }
  @media (max-width: 640px) {
    .calc-layout { grid-template-columns: 1fr; }
  }

  /* Inputs */
  .inputs-panel {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .question-text {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .fields { display: flex; flex-direction: column; gap: var(--space-3); }
  .field-inline { display: flex; flex-direction: column; gap: var(--space-1); }

  .field-label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .field-value { color: var(--accent); }

  .date-input {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color-scheme: dark;
    width: 100%;
    box-sizing: border-box;
  }
  .date-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .range-input {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
    height: 16px;
  }
  .range-bounds {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .chip-group { display: flex; flex-wrap: wrap; gap: var(--space-1); }
  .unit-chip {
    height: 24px;
    padding: 0 var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp), color var(--duration-instant) var(--ease-sharp);
  }
  .unit-chip:hover { border-color: var(--accent); }
  .unit-chip--active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
  .unit-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .radio-group { display: flex; gap: var(--space-4); }
  .radio-label {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .radio-label input { accent-color: var(--accent); }

  /* Result */
  .result-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .result-display {
    background: var(--bg-elevated);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .result-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .diff-result {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .result-value {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--accent);
    line-height: 1.1;
    letter-spacing: -0.03em;
  }
  .result-value--date { font-size: var(--text-xl); }

  .result-unit {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    color: var(--text-muted);
  }

  .breakdown-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .breakdown-item { display: flex; align-items: baseline; gap: 2px; }
  .breakdown-num {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--text-primary);
  }
  .breakdown-lbl {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }
  .breakdown-sep {
    font-family: var(--font-mono);
    color: var(--border);
    font-size: var(--text-sm);
  }

  .result-secondary {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-subtle);
  }
  .result-secondary.mono {
    font-family: var(--font-mono);
  }

  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .error-panel {
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .error-label { color: var(--danger); }
  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }
</style>
