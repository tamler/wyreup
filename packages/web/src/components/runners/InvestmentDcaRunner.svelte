<script lang="ts">
  import ChainSection from './ChainSection.svelte';
  import type { SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  void preloadedFile;

  // Currency formatting — currency selector is a future add (USD-only v1)
  const fmtCurrency = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
  const fmtShares = new Intl.NumberFormat(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  // Params
  let monthlyContribution = 500;

  // Price rows — default 12 rows, linear 100 → 120
  let priceRows: string[] = Array.from({ length: 12 }, (_, i) => (100 + i * (20 / 11)).toFixed(2));
  let pasteInput = priceRows.join(', ');
  let pasteMode = false;

  function syncRowsToPaste() {
    pasteInput = priceRows.join(', ');
  }
  function syncPasteToRows() {
    const parts = pasteInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) priceRows = parts;
    scheduleRun();
  }

  function addRow() {
    const last = parseFloat(priceRows[priceRows.length - 1] ?? '100') || 100;
    priceRows = [...priceRows, last.toFixed(2)];
    syncRowsToPaste();
    scheduleRun();
  }

  function removeRow(i: number) {
    if (priceRows.length <= 1) return;
    priceRows = priceRows.filter((_, idx) => idx !== i);
    syncRowsToPaste();
    scheduleRun();
  }

  function updateRow(i: number, val: string) {
    priceRows = priceRows.map((r, idx) => (idx === i ? val : r));
    syncRowsToPaste();
    scheduleRun();
  }

  function onPriceRowInput(i: number, e: Event) {
    const t = e.target;
    if (t instanceof HTMLInputElement) updateRow(i, t.value);
  }

  interface DcaResult {
    valid: boolean;
    totalInvested: number;
    months: number;
    endPrice: number;
    dcaTotalShares: number;
    dcaAverageCost: number;
    dcaFinalValue: number;
    lumpSumTotalShares: number;
    lumpSumAverageCost: number;
    lumpSumFinalValue: number;
    dcaWins: boolean;
    error?: string;
  }

  let result: DcaResult | null = null;
  let resultBlob: Blob | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCalc, 100);
  }

  async function runCalc() {
    const prices = priceRows.map(s => parseFloat(s)).filter(n => isFinite(n) && n > 0);
    if (prices.length === 0) return;

    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get('investment-dca');
      if (!toolModule) return;

      const blobs = await toolModule.run([], {
        monthlyContribution,
        priceHistory: prices,
      }, {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) return;
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as DcaResult;
    } catch { /* ignore */ }
  }

  // Run on mount
  scheduleRun();

  $: monthlyContribution, scheduleRun();

  function pctReturn(invested: number, final: number): string {
    if (invested === 0) return '0%';
    const pct = ((final - invested) / invested) * 100;
    return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  }

  function diffPct(a: number, b: number): string {
    if (b === 0) return 'N/A';
    const pct = ((a - b) / b) * 100;
    return Math.abs(pct).toFixed(1) + '%';
  }

  // SVG chart
  const CHART_W = 560;
  const CHART_H = 200;
  const PAD = { top: 16, right: 16, bottom: 32, left: 52 };

  interface ChartData { pricePath: string; buyPoints: { cx: number; cy: number; r: number; }[]; maxPrice: number; minPrice: number; gridY: number[]; }

  function buildChart(prices: string[], contribution: number): ChartData {
    const nums = prices.map(s => parseFloat(s)).filter(n => isFinite(n) && n > 0);
    if (nums.length < 2) return { pricePath: '', buyPoints: [], maxPrice: 0, minPrice: 0, gridY: [] };

    const maxPrice = Math.max(...nums);
    const minPrice = Math.min(...nums);
    const plotW = CHART_W - PAD.left - PAD.right;
    const plotH = CHART_H - PAD.top - PAD.bottom;
    const priceRange = maxPrice - minPrice || 1;

    function xOf(i: number) { return PAD.left + (i / (nums.length - 1)) * plotW; }
    function yOf(p: number) { return PAD.top + plotH - ((p - minPrice) / priceRange) * plotH; }

    const pricePath = nums.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p).toFixed(1)}`).join(' ');

    const maxShares = Math.max(...nums.map(p => contribution / p));
    const buyPoints = nums.map((p, i) => {
      const shares = contribution / p;
      const r = Math.max(2, Math.min(6, (shares / maxShares) * 6));
      return { cx: xOf(i), cy: yOf(p), r };
    });

    const step = niceStep(maxPrice - minPrice, 4);
    const gridY: number[] = [];
    const base = Math.ceil(minPrice / step) * step;
    for (let v = base; v <= maxPrice; v += step) gridY.push(v);

    return { pricePath, buyPoints, maxPrice, minPrice, gridY };
  }

  function niceStep(range: number, steps: number): number {
    if (range === 0) return 1;
    const raw = range / steps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  function yToSvg(v: number, minP: number, maxP: number): number {
    const plotH = CHART_H - PAD.top - PAD.bottom;
    return PAD.top + plotH - ((v - minP) / (maxP - minP || 1)) * plotH;
  }

  $: chartData = buildChart(priceRows, monthlyContribution);
</script>

<div class="runner">
  <div class="layout">
    <!-- Inputs -->
    <div class="inputs-panel">
      <div class="panel-label-row">
        <span class="panel-label">Parameters</span>
      </div>
      <div class="panel-divider"></div>

      <div class="field">
        <label class="field-label" for="dca-contrib">Monthly contribution</label>
        <div class="input-wrap">
          <span class="input-prefix">$</span>
          <input
            id="dca-contrib"
            class="num-input"
            type="number"
            min="1"
            step="100"
            bind:value={monthlyContribution}
            on:input={scheduleRun}
          />
        </div>
      </div>

      <div class="field">
        <div class="field-label-row">
          <span class="field-label">Price history</span>
          <button
            class="mode-toggle"
            type="button"
            on:click={() => { pasteMode = !pasteMode; if (!pasteMode) syncRowsToPaste(); }}
          >{pasteMode ? 'Row edit' : 'Paste CSV'}</button>
        </div>

        {#if pasteMode}
          <textarea
            class="paste-area"
            placeholder="100, 105, 110, 108, ..."
            bind:value={pasteInput}
            on:input={syncPasteToRows}
            rows="4"
          ></textarea>
          <span class="field-hint">{priceRows.filter(s => parseFloat(s) > 0).length} prices parsed</span>
        {:else}
          <div class="rows-editor">
            {#each priceRows as row, i}
              <div class="price-row">
                <span class="row-num">{i + 1}</span>
                <input
                  class="price-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={row}
                  on:input={(e) => onPriceRowInput(i, e)}
                />
                <button
                  class="row-remove"
                  type="button"
                  on:click={() => removeRow(i)}
                  aria-label="Remove row {i + 1}"
                  disabled={priceRows.length <= 1}
                >&#x2715;</button>
              </div>
            {/each}
            <button class="btn-add-row" type="button" on:click={addRow}>+ Add month</button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Results -->
    {#if result && result.valid}
      <div class="result-col">
        <!-- Winner banner -->
        <div class="winner-banner" class:winner--dca={result.dcaWins} class:winner--lump={!result.dcaWins}>
          <span class="winner-indicator"></span>
          <span class="winner-text">
            {#if result.dcaWins}
              DCA outperformed lump-sum by {diffPct(result.dcaFinalValue, result.lumpSumFinalValue)}
            {:else}
              Lump-sum outperformed DCA by {diffPct(result.lumpSumFinalValue, result.dcaFinalValue)}
            {/if}
          </span>
        </div>

        <!-- Comparison cards -->
        <div class="cards-row">
          <div class="card" class:card--winner={result.dcaWins}>
            <span class="card-label">DCA</span>
            <div class="panel-divider"></div>
            <div class="stat-row">
              <span class="stat-name">Total shares</span>
              <span class="stat-val">{fmtShares.format(result.dcaTotalShares)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Avg cost</span>
              <span class="stat-val">{fmtCurrency.format(result.dcaAverageCost)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Final value</span>
              <span class="stat-val stat-val--primary">{fmtCurrency.format(result.dcaFinalValue)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Return</span>
              <span class="stat-val stat-val--accent">{pctReturn(result.totalInvested, result.dcaFinalValue)}</span>
            </div>
          </div>

          <div class="card" class:card--winner={!result.dcaWins}>
            <span class="card-label">Lump-sum</span>
            <div class="panel-divider"></div>
            <div class="stat-row">
              <span class="stat-name">Total shares</span>
              <span class="stat-val">{fmtShares.format(result.lumpSumTotalShares)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Avg cost</span>
              <span class="stat-val">{fmtCurrency.format(result.lumpSumAverageCost)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Final value</span>
              <span class="stat-val stat-val--primary">{fmtCurrency.format(result.lumpSumFinalValue)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Return</span>
              <span class="stat-val stat-val--accent">{pctReturn(result.totalInvested, result.lumpSumFinalValue)}</span>
            </div>
          </div>
        </div>

        <!-- Price history chart with DCA buy points -->
        {#if chartData.pricePath}
          <div class="chart-wrap">
            <div class="chart-header-row">
              <span class="panel-label">Price history + DCA buy points</span>
            </div>
            <svg
              class="chart"
              viewBox="0 0 {CHART_W} {CHART_H}"
              aria-label="Price history chart with DCA buy points"
              role="img"
            >
              <!-- Y gridlines -->
              {#each chartData.gridY as gv}
                {@const gy = yToSvg(gv, chartData.minPrice, chartData.maxPrice)}
                <line x1={PAD.left} y1={gy} x2={CHART_W - PAD.right} y2={gy} stroke="var(--border-subtle)" stroke-width="1" />
                <text x={PAD.left - 4} y={gy + 4} text-anchor="end" class="axis-label">{gv.toFixed(0)}</text>
              {/each}

              <!-- X axis labels -->
              {#each priceRows as _, i}
                {#if i === 0 || (i + 1) % Math.max(1, Math.floor(priceRows.length / 5)) === 0 || i === priceRows.length - 1}
                  {@const px = PAD.left + (i / (priceRows.length - 1 || 1)) * (CHART_W - PAD.left - PAD.right)}
                  <text x={px} y={CHART_H - PAD.bottom + 14} text-anchor="middle" class="axis-label">M{i + 1}</text>
                {/if}
              {/each}

              <!-- Price line -->
              <path d={chartData.pricePath} fill="none" stroke="var(--text-muted)" stroke-width="1" />

              <!-- DCA buy points -->
              {#each chartData.buyPoints as pt}
                <circle
                  cx={pt.cx}
                  cy={pt.cy}
                  r={pt.r}
                  fill="var(--accent)"
                  fill-opacity="0.7"
                  stroke="var(--accent)"
                  stroke-width="1"
                />
              {/each}
            </svg>
            <div class="chart-legend">
              <span class="legend-item">
                <span class="legend-line legend-line--muted"></span>
                Price
              </span>
              <span class="legend-item">
                <svg width="10" height="10" style="flex-shrink:0"><circle cx="5" cy="5" r="4" fill="var(--accent)" fill-opacity="0.7" /></svg>
                DCA buy (size = shares)
              </span>
            </div>
          </div>
        {/if}

        {#if resultBlob}
          <ChainSection {resultBlob} resultName="investment-dca-result.json" />
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
  .field-label-row { display: flex; align-items: center; justify-content: space-between; }
  .field-label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .field-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .mode-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px var(--space-2);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp), color var(--duration-instant) var(--ease-sharp);
  }
  .mode-toggle:hover { border-color: var(--accent); color: var(--accent); }

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
  .input-wrap:focus-within { border-color: var(--accent); }

  .paste-area {
    width: 100%;
    padding: var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    resize: vertical;
    box-sizing: border-box;
  }
  .paste-area:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .rows-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 280px;
    overflow-y: auto;
  }

  .price-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .row-num {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    width: 20px;
    text-align: right;
    flex-shrink: 0;
  }

  .price-input {
    flex: 1;
    height: 28px;
    padding: 0 var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    min-width: 0;
  }
  .price-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .row-remove {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 2px var(--space-1);
    transition: color var(--duration-instant) var(--ease-sharp);
    flex-shrink: 0;
  }
  .row-remove:hover:not(:disabled) { color: var(--danger); }
  .row-remove:disabled { opacity: 0.3; cursor: not-allowed; }

  .btn-add-row {
    align-self: flex-start;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp), color var(--duration-instant) var(--ease-sharp);
  }
  .btn-add-row:hover { border-color: var(--accent); color: var(--accent); }

  /* Result */
  .result-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .winner-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
  }
  .winner--dca { border-color: var(--accent); background: var(--accent-dim); }
  .winner--lump { border-color: var(--border); }

  .winner-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-subtle);
    flex-shrink: 0;
  }
  .winner--dca .winner-indicator { background: var(--accent); }

  .winner-text {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .winner--dca .winner-text { color: var(--accent); }

  .cards-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
    gap: var(--space-2);
  }
  .card--winner { border-color: var(--accent); }

  .card-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
  }
  .stat-name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .stat-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    text-align: right;
  }
  .stat-val--primary { font-weight: 700; font-size: var(--text-md); }
  .stat-val--accent { color: var(--accent); }

  /* Chart */
  .chart-wrap {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-3) var(--space-3);
  }
  .chart-header-row { margin-bottom: var(--space-2); }
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
  .legend-line--muted { background: var(--text-muted); }

  :global(.axis-label) {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--text-subtle);
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
  .error-label { color: var(--danger); }
  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }
</style>
