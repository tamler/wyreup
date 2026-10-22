<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DateCalculatorParams, ToolModule } from '@wyreup/core';
  import ChainSection from './ChainSection.svelte';
  import type { SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let injectedTool: ToolModule<DateCalculatorParams> | undefined = undefined;
  export let showChain = true;
  void preloadedFile;

  type Mode = 'diff' | 'add' | 'day-of-week';
  type Unit = 'days' | 'weeks' | 'months' | 'years';
  const MODES: { id: Mode; label: string }[] = [
    { id: 'diff', label: 'Difference' },
    { id: 'add', label: 'Add / Subtract' },
    { id: 'day-of-week', label: 'Day of week' },
  ];
  const UNITS: { id: Unit; label: string }[] = [
    { id: 'days', label: 'Days' },
    { id: 'weeks', label: 'Weeks' },
    { id: 'months', label: 'Months' },
    { id: 'years', label: 'Years' },
  ];
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const AMOUNT_LIMITS = { days: 73050, weeks: 10435, months: 2400, years: 200 };
  let mode: Mode = 'diff';
  let diffDate1 = '2026-01-01';
  let diffDate2 = '2026-12-31';
  let weekend = [6, 7];
  let holidaysText = '';
  let addDate1 = '2026-04-17';
  let addAmount: number | undefined = 30;
  let addUnit: Unit = 'days';
  let addDir = 1;
  let overflow: 'constrain' | 'reject' = 'constrain';
  let dowDate = '2026-04-17';

  interface DateResult {
    valid: boolean;
    mode?: string;
    totalDays?: number;
    totalWeeks?: number;
    totalHours?: number;
    businessDays?: number;
    breakdown?: { years: number; months: number; days: number };
    result?: string;
    dayName?: string;
    error?: string;
  }
  let result: DateResult | null = null;
  let resultBlob: Blob | null = null;
  let error = '';
  let copyError = '';
  let copied = false;
  let running = false;
  let generation = 0;
  let controller: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  const urls = new Set<string>();

  function clearUrls() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  }
  function cancel() {
    generation++;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (copyTimer) clearTimeout(copyTimer);
    debounceTimer = null;
    copyTimer = null;
    controller?.abort();
    controller = null;
    running = false;
    copied = false;
    clearUrls();
  }
  function scheduleRun() {
    cancel();
    result = null;
    resultBlob = null;
    error = '';
    copyError = '';
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runCalc();
    }, 80);
  }
  function toggleWeekend(day: number, checked: boolean) {
    weekend = checked
      ? [...weekend, day].sort((a, b) => a - b)
      : weekend.filter((value) => value !== day);
  }
  function currentParams(): DateCalculatorParams {
    if (mode === 'diff') {
      const holidays = holidaysText.trim()
        ? holidaysText
            .trim()
            .split(/\r?\n/)
            .map((day) => day.trim())
        : [];
      if (holidays.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day)))
        throw new Error('Use one exact YYYY-MM-DD holiday per line, with no blank entries.');
      return { mode, date1: diffDate1, date2: diffDate2, weekend: [...weekend], holidays };
    }
    if (mode === 'add') {
      if (typeof addAmount !== 'number' || !Number.isInteger(addAmount) || addAmount < 0)
        throw new Error('Enter a nonnegative whole-number amount; choose Add or Subtract.');
      return { mode, date1: addDate1, amount: addAmount * addDir, unit: addUnit, overflow };
    }
    return { mode, date1: dowDate };
  }
  async function runCalc() {
    const ownGeneration = generation;
    const ownController = new AbortController();
    controller = ownController;
    running = true;
    try {
      const params = currentParams();
      const module =
        injectedTool ??
        (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get('date-calculator');
      if (!module) throw new Error('Date calculator is unavailable.');
      if (ownGeneration !== generation) return;
      const outputs = await module.run([], params, {
        onProgress: () => {},
        signal: ownController.signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      if (ownGeneration !== generation) return;
      const blob = Array.isArray(outputs) ? outputs[0] : outputs;
      if (!blob || blob.type !== 'application/json')
        throw new Error('Date calculator returned an invalid result.');
      const parsed = JSON.parse(await blob.text()) as DateResult;
      if (ownGeneration !== generation) return;
      if (typeof parsed.valid !== 'boolean')
        throw new Error('Date calculator returned an invalid result.');
      result = parsed;
      resultBlob = parsed.valid ? blob : null;
    } catch (cause) {
      if (ownGeneration === generation)
        error = cause instanceof Error ? cause.message : 'Date calculation failed.';
    } finally {
      if (ownGeneration === generation) {
        running = false;
        controller = null;
      }
    }
  }
  async function copyJson() {
    const blob = resultBlob;
    const ownGeneration = generation;
    if (!blob) return;
    copyError = '';
    try {
      const text = await blob.text();
      if (ownGeneration !== generation) return;
      await navigator.clipboard.writeText(text);
      if (ownGeneration !== generation) return;
      copied = true;
      copyTimer = setTimeout(() => {
        copied = false;
        copyTimer = null;
      }, 1500);
    } catch (cause) {
      if (ownGeneration === generation)
        copyError = cause instanceof Error ? cause.message : 'Copy failed.';
    }
  }
  function downloadJson() {
    if (!resultBlob) return;
    try {
      clearUrls();
      const url = URL.createObjectURL(resultBlob);
      urls.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'date-calculator-result.json';
      link.click();
    } catch (cause) {
      clearUrls();
      error = cause instanceof Error ? cause.message : 'JSON download failed.';
    }
  }
  $: ((mode,
  diffDate1,
  diffDate2,
  weekend,
  holidaysText,
  addDate1,
  addAmount,
  addUnit,
  addDir,
  overflow,
  dowDate),
    scheduleRun());
  onDestroy(cancel);
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
        <div class="question-text">Signed calendar and business-day differences</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="diff-date1">Start date</label>
            <input id="diff-date1" class="date-input" type="date" min="1900-01-01" max="2100-12-31" bind:value={diffDate1} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="diff-date2">End date</label>
            <input id="diff-date2" class="date-input" type="date" min="1900-01-01" max="2100-12-31" bind:value={diffDate2} />
          </div>
        </div>

        <fieldset><legend>Weekend ISO weekdays</legend>
          {#each WEEKDAYS as name, index}<label><input type="checkbox" checked={weekend.includes(index + 1)} on:change={event => toggleWeekend(index + 1, event.currentTarget.checked)} />{name} ({index + 1})</label>{/each}
        </fieldset>
        <label class="field-label" for="date-holidays">Holiday dates, one YYYY-MM-DD per line</label>
        <textarea id="date-holidays" class="date-input" rows="4" bind:value={holidaysText}></textarea>
        <p>Business days use [earlier date, later date), with the sign of the difference. Empty weekend selection counts every weekday; holidays already on weekends are excluded once. Hours are date-only days × 24.</p>

      {:else if mode === 'add'}
        <div class="question-text">Add or subtract time from a date</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="add-date1">Start date</label>
            <input id="add-date1" class="date-input" type="date" min="1900-01-01" max="2100-12-31" bind:value={addDate1} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="add-amount">Amount — <span class="field-value">{addAmount} {addUnit}</span></label>
            <input id="add-amount" class="date-input" type="number" min="0" max={AMOUNT_LIMITS[addUnit]} step="1" bind:value={addAmount} />
          </div>
          <div class="field-inline">
            <span class="field-label">Unit</span>
            <div class="chip-group">
              {#each UNITS as u}
                <button
                  class="unit-chip"
                  class:unit-chip--active={addUnit === u.id}
                  type="button"
                  on:click={() => { addUnit = u.id; }}
                >{u.label}</button>
              {/each}
            </div>
          </div>
          <div class="field-inline">
            <span class="field-label">Direction</span>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" name="add-dir" value={1} bind:group={addDir} />
                Add
              </label>
              <label class="radio-label">
                <input type="radio" name="add-dir" value={-1} bind:group={addDir} />
                Subtract
              </label>
            </div>
          </div>
        </div>

        <label class="field-label" for="date-overflow">Month-end behavior</label>
        <select id="date-overflow" class="date-input" bind:value={overflow}><option value="constrain">Constrain to last valid day</option><option value="reject">Reject an invalid day</option></select>

      {:else if mode === 'day-of-week'}
        <div class="question-text">What day of the week is a date?</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="dow-date">Date</label>
            <input id="dow-date" class="date-input" type="date" min="1900-01-01" max="2100-12-31" bind:value={dowDate} />
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
              <span class="result-value" data-result="days">{result.totalDays}</span>
              <span class="result-unit">days</span>
            </div>
            <dl><dt>Signed weeks</dt><dd data-result="weeks">{result.totalWeeks}</dd><dt>Date-only hours</dt><dd data-result="hours">{result.totalHours}</dd><dt>Business days</dt><dd data-result="business-days">{result.businessDays}</dd></dl>
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
            <span class="result-secondary mono">ISO 8601: {result.result}</span>

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

      {#if running}<p role="status">Calculating</p>{/if}
      {#if error}<p role="alert">{error}</p>{/if}
      {#if copyError}<p role="alert">{copyError}</p>{/if}
      {#if resultBlob}<div><button type="button" on:click={copyJson}>{copied ? 'Copied' : 'Copy JSON'}</button><button type="button" on:click={downloadJson}>Download JSON</button></div>{/if}
      {#if resultBlob && showChain}
        <ChainSection {resultBlob} sourceToolId={tool.id} resultName="date-calculator-result.json" />
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
  .chip:hover { border-color: var(--accent-hover); color: var(--text-primary); }
  .chip--active {
    background: var(--accent);
    border-color: var(--accent-hover);
    color: var(--black);
    font-weight: 500;
  }
  .chip:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
  .field-value { color: var(--accent-text); }

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
  .date-input:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }


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
  .unit-chip:hover { border-color: var(--accent-hover); }
  .unit-chip--active { background: var(--accent-dim); border-color: var(--accent-hover); color: var(--accent-text); }
  .unit-chip:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
    border: 1px solid var(--accent-hover);
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
    color: var(--accent-text);
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
