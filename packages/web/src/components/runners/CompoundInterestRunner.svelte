<script lang="ts">
  import ChainSection from './ChainSection.svelte';
  import type { SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  void preloadedFile; // finance tools take no file input

  // Currency formatting — currency selector is a future add (USD-only v1)
  const fmt = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  const fmtDec = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

  function fmtN(n: number): string {
    return Math.abs(n) >= 1000 ? fmt.format(n) : fmtDec.format(n);
  }

  const FREQ_OPTIONS = [
    { value: 12,  label: 'Monthly' },
    { value: 365, label: 'Daily' },
    { value: 1,   label: 'Annually' },
    { value: 4,   label: 'Quarterly' },
  ];

  // Params (live, debounced)
  let principal = 10000;
  let annualRate = 7;
  let years = 10;
  let compoundingPerYear = 12;
  let monthlyContribution = 0;

  // Result
  interface YearRow { year: number; balance: number; contributionTotal: number; interestTotal: number; }
  interface Result {
    valid: boolean;
    finalBalance: number;
    totalContributions: number;
    totalInterest: number;
    yearlyBreakdown: YearRow[];
    error?: string;
  }

  let result: Result | null = null;
  let resultBlob: Blob | null = null;
  let tableOpen = false;
  let copied = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCalc, 100);
  }

  async function runCalc() {
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get('compound-interest');
      if (!toolModule) return;

      const blobs = await toolModule.run([], {
        principal,
        annualRate,
        years,
        compoundingPerYear,
        monthlyContribution,
      }, {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) return;
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as Result;
    } catch { /* ignore */ }
  }

  // Run on mount
  scheduleRun();

  $: (principal, annualRate, years, compoundingPerYear, monthlyContribution), scheduleRun();

  async function copyJson() {
    if (!resultBlob) return;
    try {
      await navigator.clipboard.writeText(await resultBlob.text());
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch { /* ignore */ }
  }

  // SVG chart helpers
  const CHART_W = 560;
  const CHART_H = 220;
  const PAD = { top: 16, right: 16, bottom: 32, left: 64 };

  function chartCoords(data: YearRow[]): { contribPath: string; totalPath: string; gridY: number[]; gridX: number[]; maxY: number; } {
    if (!data.length) return { contribPath: '', totalPath: '', gridY: [], gridX: [], maxY: 0 };
    const maxY = Math.max(...data.map(d => d.balance));
    const plotW = CHART_W - PAD.left - PAD.right;
    const plotH = CHART_H - PAD.top - PAD.bottom;

    function xOf(i: number) { return PAD.left + (i / (data.length - 1 || 1)) * plotW; }
    function yOf(v: number) { return PAD.top + plotH - (v / maxY) * plotH; }

    const totalPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d.balance).toFixed(1)}`).join(' ');
    const contribPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d.contributionTotal).toFixed(1)}`).join(' ');

    // Grid lines: up to 5 Y gridlines at nice intervals
    const yStep = niceStep(maxY, 5);
    const gridY: number[] = [];
    for (let v = 0; v <= maxY; v += yStep) gridY.push(v);

    const gridX: number[] = data.map((_, i) => i);

    return { contribPath, totalPath, gridY, gridX, maxY };
  }

  function niceStep(max: number, steps: number): number {
    const raw = max / steps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  function yToSvg(v: number, maxY: number): number {
    const plotH = CHART_H - PAD.top - PAD.bottom;
    return PAD.top + plotH - (v / maxY) * plotH;
  }

  function xOfYear(year: number, total: number): number {
    const plotW = CHART_W - PAD.left - PAD.right;
    return PAD.left + ((year - 1) / (total - 1 || 1)) * plotW;
  }

  function shortFmt(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }
</script>

<div class="runner">
  <!-- Input / Result layout -->
  <div class="layout">
    <!-- Inputs -->
    <div class="inputs-panel">
      <div class="panel-label-row">
        <span class="panel-label">Parameters</span>
      </div>
      <div class="panel-divider"></div>

      <div class="field">
        <label class="field-label" for="ci-principal">Principal</label>
        <div class="input-wrap">
          <span class="input-prefix">$</span>
          <input
            id="ci-principal"
            class="num-input"
            type="number"
            min="0"
            step="100"
            bind:value={principal}
            on:input={scheduleRun}
          />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="ci-rate">Annual rate — <span class="field-value">{annualRate.toFixed(1)}%</span></label>
        <input
          id="ci-rate"
          class="range-input"
          type="range"
          min="0"
          max="30"
          step="0.1"
          bind:value={annualRate}
          on:input={scheduleRun}
        />
        <div class="range-bounds"><span>0%</span><span>30%</span></div>
      </div>

      <div class="field">
        <label class="field-label" for="ci-years">Years — <span class="field-value">{years}</span></label>
        <input
          id="ci-years"
          class="range-input"
          type="range"
          min="1"
          max="50"
          step="1"
          bind:value={years}
          on:input={scheduleRun}
        />
        <div class="range-bounds"><span>1</span><span>50</span></div>
      </div>

      <div class="field">
        <label class="field-label" for="ci-freq">Compounding frequency</label>
        <select id="ci-freq" class="select-input" bind:value={compoundingPerYear} on:change={scheduleRun}>
          {#each FREQ_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="ci-contrib">Monthly contribution</label>
        <div class="input-wrap">
          <span class="input-prefix">$</span>
          <input
            id="ci-contrib"
            class="num-input"
            type="number"
            min="0"
            step="50"
            bind:value={monthlyContribution}
            on:input={scheduleRun}
          />
        </div>
      </div>
    </div>

    <!-- Results -->
    {#if result && result.valid}
      <div class="result-col">
        <!-- Summary cards -->
        <div class="cards-row">
          <div class="card card--accent">
            <span class="card-label">Final balance</span>
            <span class="card-value card-value--accent">{fmtN(result.finalBalance)}</span>
          </div>
          <div class="card">
            <span class="card-label">Total contributions</span>
            <span class="card-value card-value--muted">{fmtN(result.totalContributions)}</span>
          </div>
          <div class="card card--accent-dim">
            <span class="card-label">Interest earned</span>
            <span class="card-value card-value--accent">{fmtN(result.totalInterest)}</span>
          </div>
        </div>

        <!-- Growth chart -->
        {#if result.yearlyBreakdown.length > 1}
          {@const chart = chartCoords(result.yearlyBreakdown)}
          <div class="chart-wrap">
            <svg
              class="chart"
              viewBox="0 0 {CHART_W} {CHART_H}"
              aria-label="Compound interest growth chart"
              role="img"
            >
              <!-- Y gridlines -->
              {#each chart.gridY as gv}
                {#if gv <= chart.maxY}
                  {@const gy = yToSvg(gv, chart.maxY)}
                  <line
                    x1={PAD.left}
                    y1={gy}
                    x2={CHART_W - PAD.right}
                    y2={gy}
                    stroke="var(--border-subtle)"
                    stroke-width="1"
                  />
                  <text
                    x={PAD.left - 6}
                    y={gy + 4}
                    text-anchor="end"
                    class="axis-label"
                  >{shortFmt(gv)}</text>
                {/if}
              {/each}

              <!-- X axis labels (year) -->
              {#each result.yearlyBreakdown as row, i}
                {#if i === 0 || (i + 1) % Math.max(1, Math.floor(result.yearlyBreakdown.length / 5)) === 0 || i === result.yearlyBreakdown.length - 1}
                  <text
                    x={xOfYear(row.year, result.yearlyBreakdown.length)}
                    y={CHART_H - PAD.bottom + 16}
                    text-anchor="middle"
                    class="axis-label"
                  >{row.year}y</text>
                {/if}
              {/each}

              <!-- Contributions-only line (muted) -->
              <path
                d={chart.contribPath}
                fill="none"
                stroke="var(--text-subtle)"
                stroke-width="1"
              />

              <!-- Total balance line (amber) -->
              <path
                d={chart.totalPath}
                fill="none"
                stroke="var(--accent)"
                stroke-width="1.5"
              />
            </svg>

            <div class="chart-legend">
              <span class="legend-item legend-item--muted">
                <span class="legend-line legend-line--muted"></span>
                Contributions
              </span>
              <span class="legend-item">
                <span class="legend-line legend-line--accent"></span>
                Total balance
              </span>
            </div>
          </div>
        {/if}

        <!-- Year-by-year table (collapsible) -->
        <div class="table-wrap">
          <button
            class="table-toggle"
            type="button"
            on:click={() => { tableOpen = !tableOpen; }}
            aria-expanded={tableOpen}
          >
            <span class="panel-label">Year-by-year breakdown</span>
            <span class="toggle-caret" class:open={tableOpen}>&#9660;</span>
          </button>
          {#if tableOpen}
            <div class="panel-divider"></div>
            <table class="breakdown-table" aria-label="Year-by-year breakdown">
              <thead>
                <tr>
                  <th class="th">Year</th>
                  <th class="th th--r">Balance</th>
                  <th class="th th--r">Contributions</th>
                  <th class="th th--r">Interest</th>
                </tr>
              </thead>
              <tbody>
                {#each result.yearlyBreakdown as row}
                  <tr class="tr">
                    <td class="td">{row.year}</td>
                    <td class="td td--r td--accent">{fmtN(row.balance)}</td>
                    <td class="td td--r">{fmtN(row.contributionTotal)}</td>
                    <td class="td td--r">{fmtN(row.interestTotal)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <!-- Copy JSON -->
        <div class="copy-row">
          <button class="btn-ghost" type="button" on:click={copyJson}>
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
        </div>

        {#if resultBlob}
          <ChainSection {resultBlob} resultName="compound-interest-result.json" />
        {/if}
      </div>
    {:else if result && !result.valid}
      <div class="error-panel" role="alert">
        <span class="panel-label error-label">Error</span>
        <div class="panel-divider"></div>
        <p class="error-msg">{result.error ?? 'Unknown error'}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

  .layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: var(--space-6);
    align-items: start;
  }

  @media (max-width: 640px) {
    .layout { grid-template-columns: 1fr; }
  }

  /* Inputs panel */
  .inputs-panel {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel-label-row { display: flex; align-items: center; }
  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .field { display: flex; flex-direction: column; gap: var(--space-1); }
  .field-label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .field-value {
    color: var(--accent);
    font-weight: 500;
  }

  .input-wrap {
    display: flex;
    align-items: center;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .input-prefix {
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    border-right: 1px solid var(--border-subtle);
    height: 32px;
    display: flex;
    align-items: center;
  }
  .num-input {
    flex: 1;
    height: 32px;
    padding: 0 var(--space-2);
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    outline: none;
    min-width: 0;
  }
  .num-input:focus { outline: none; }
  .input-wrap:focus-within { border-color: var(--accent); }

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

  .select-input {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .select-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Result column */
  .result-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Summary cards */
  .cards-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }
  @media (max-width: 640px) {
    .cards-row { grid-template-columns: 1fr; }
  }

  .card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .card--accent { border-color: var(--accent); }
  .card--accent-dim { background: var(--accent-dim); border-color: var(--accent); }
  .card-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }
  .card-value {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.1;
    letter-spacing: -0.03em;
  }
  .card-value--accent { color: var(--accent); }
  .card-value--muted { color: var(--text-muted); }

  /* Chart */
  .chart-wrap {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-3) var(--space-3);
    overflow: hidden;
  }
  .chart {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }
  .chart-legend {
    display: flex;
    gap: var(--space-4);
    padding-top: var(--space-2);
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .legend-line {
    display: inline-block;
    width: 20px;
    height: 1px;
  }
  .legend-line--accent { background: var(--accent); height: 1.5px; }
  .legend-line--muted { background: var(--text-subtle); }

  :global(.axis-label) {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--text-subtle);
  }

  /* Table */
  .table-wrap {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .table-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: none;
    border: none;
    cursor: pointer;
  }
  .table-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .toggle-caret {
    font-size: var(--text-xs);
    color: var(--text-subtle);
    transition: transform var(--duration-base) var(--ease-sharp);
    display: inline-block;
  }
  .toggle-caret.open { transform: rotate(180deg); }

  .breakdown-table {
    width: 100%;
    border-collapse: collapse;
  }
  .th {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
    padding: var(--space-2) var(--space-4);
    text-align: left;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border-subtle);
  }
  .th--r { text-align: right; }
  .tr:nth-child(even) { background: var(--bg-raised); }
  .td {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }
  .td--r { text-align: right; }
  .td--accent { color: var(--accent); }

  /* Copy + misc */
  .copy-row { display: flex; justify-content: flex-end; }
  .btn-ghost {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .btn-ghost:hover { color: var(--text-muted); }
  .btn-ghost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
