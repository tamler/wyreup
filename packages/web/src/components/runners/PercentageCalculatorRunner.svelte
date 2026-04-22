<script lang="ts">
  import ChainSection from './ChainSection.svelte';
  import type { SerializedTool } from './types';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  void preloadedFile;

  type Mode = 'percent-of' | 'what-percent' | 'percent-change' | 'increase-decrease';

  const MODES: { id: Mode; label: string }[] = [
    { id: 'percent-of',       label: 'Percent of' },
    { id: 'what-percent',     label: 'What percent' },
    { id: 'percent-change',   label: 'Percent change' },
    { id: 'increase-decrease', label: 'Increase / Decrease' },
  ];

  let mode: Mode = 'percent-of';

  // Per-mode values
  let poValue = 20;     // "What is X% of Y?" — X
  let poBase  = 250;    // Y
  let wpValue = 50;     // "X is what % of Y?" — X
  let wpBase  = 200;    // Y
  let pcFrom  = 100;    // percent-change from
  let pcTo    = 125;    // percent-change to
  let idValue = 500;    // increase-decrease base value
  let idPct   = 15;     // percentage
  let idDir   = 1;      // 1 = increase, -1 = decrease

  interface CalcResult {
    valid: boolean;
    result?: number;
    formatted?: string;
    error?: string;
  }

  let result: CalcResult | null = null;
  let resultBlob: Blob | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCalc, 80);
  }

  async function runCalc() {
    let params: Record<string, unknown> = { mode };

    if (mode === 'percent-of') {
      params = { mode, value: poValue, base: poBase };
    } else if (mode === 'what-percent') {
      params = { mode, value: wpValue, base: wpBase };
    } else if (mode === 'percent-change') {
      params = { mode, value: pcFrom, base: pcTo };
    } else if (mode === 'increase-decrease') {
      params = { mode, value: idValue, percent: idPct * idDir };
    }

    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get('percentage-calculator');
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
      result = JSON.parse(await blob.text()) as CalcResult;
    } catch { /* ignore */ }
  }

  scheduleRun();

  $: mode, scheduleRun();
  $: (poValue, poBase, wpValue, wpBase, pcFrom, pcTo, idValue, idPct, idDir), scheduleRun();

  function fmtResult(r: number, m: Mode): string {
    if (m === 'percent-of' || m === 'increase-decrease') {
      return r.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    if (m === 'what-percent') {
      return r.toFixed(4) + '%';
    }
    if (m === 'percent-change') {
      return (r >= 0 ? '+' : '') + r.toFixed(2) + '%';
    }
    return String(r);
  }

  function explanation(m: Mode): string {
    if (m === 'percent-of') return `${poValue}% × ${poBase} = ${poValue / 100} × ${poBase}`;
    if (m === 'what-percent') return `${wpValue} / ${wpBase} × 100`;
    if (m === 'percent-change') return `(${pcTo} − ${pcFrom}) / ${pcFrom} × 100`;
    if (m === 'increase-decrease') {
      const sign = idDir >= 0 ? '+' : '−';
      return `${idValue} × (1 ${sign} ${idPct}/100)`;
    }
    return '';
  }
</script>

<div class="runner">
  <!-- Mode chips -->
  <div class="mode-chips" role="group" aria-label="Calculator mode">
    {#each MODES as m}
      <button
        class="chip"
        class:chip--active={mode === m.id}
        type="button"
        on:click={() => { mode = m.id; }}
      >{m.label}</button>
    {/each}
  </div>

  <!-- Input form (mode-conditional) -->
  <div class="calc-layout">
    <div class="inputs-panel">
      {#if mode === 'percent-of'}
        <div class="question-text">What is <span class="q-var">X%</span> of <span class="q-var">Y</span>?</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="po-value">X (percent)</label>
            <div class="input-wrap">
              <input id="po-value" class="num-input" type="number" step="0.1" bind:value={poValue} on:input={scheduleRun} />
              <span class="input-suffix">%</span>
            </div>
          </div>
          <div class="field-inline">
            <label class="field-label" for="po-base">Y (value)</label>
            <input id="po-base" class="num-input-bare" type="number" step="1" bind:value={poBase} on:input={scheduleRun} />
          </div>
        </div>

      {:else if mode === 'what-percent'}
        <div class="question-text"><span class="q-var">X</span> is what percent of <span class="q-var">Y</span>?</div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="wp-value">X</label>
            <input id="wp-value" class="num-input-bare" type="number" step="1" bind:value={wpValue} on:input={scheduleRun} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="wp-base">Y</label>
            <input id="wp-base" class="num-input-bare" type="number" step="1" bind:value={wpBase} on:input={scheduleRun} />
          </div>
        </div>

      {:else if mode === 'percent-change'}
        <div class="question-text">Percent change from <span class="q-var">X</span> to <span class="q-var">Y</span></div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="pc-from">From (X)</label>
            <input id="pc-from" class="num-input-bare" type="number" step="1" bind:value={pcFrom} on:input={scheduleRun} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="pc-to">To (Y)</label>
            <input id="pc-to" class="num-input-bare" type="number" step="1" bind:value={pcTo} on:input={scheduleRun} />
          </div>
        </div>

      {:else if mode === 'increase-decrease'}
        <div class="question-text"><span class="q-var">X</span> increased / decreased by <span class="q-var">Y%</span></div>
        <div class="fields">
          <div class="field-inline">
            <label class="field-label" for="id-value">X (value)</label>
            <input id="id-value" class="num-input-bare" type="number" step="1" bind:value={idValue} on:input={scheduleRun} />
          </div>
          <div class="field-inline">
            <label class="field-label" for="id-pct">Y (percent) — <span class="field-value">{idPct}%</span></label>
            <input id="id-pct" class="range-input" type="range" min="0" max="200" step="0.5" bind:value={idPct} on:input={scheduleRun} />
            <div class="range-bounds"><span>0%</span><span>200%</span></div>
          </div>
          <div class="field-inline">
            <span class="field-label">Direction</span>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" name="id-dir" value={1} bind:group={idDir} on:change={scheduleRun} />
                Increase
              </label>
              <label class="radio-label">
                <input type="radio" name="id-dir" value={-1} bind:group={idDir} on:change={scheduleRun} />
                Decrease
              </label>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Result -->
    <div class="result-col">
      {#if result && result.valid && result.result !== undefined}
        <div class="result-display">
          <span class="result-label">Result</span>
          <span class="result-value">{fmtResult(result.result, mode)}</span>
          <span class="result-explain">{explanation(mode)}</span>
        </div>
      {:else if result && !result.valid}
        <div class="error-panel" role="alert">
          <span class="panel-label error-label">Error</span>
          <div class="panel-divider"></div>
          <p class="error-msg">{result.error ?? 'Unknown error'}</p>
        </div>
      {/if}

      {#if resultBlob}
        <ChainSection {resultBlob} resultName="percentage-calculator-result.json" />
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
  .q-var {
    color: var(--accent);
    font-family: var(--font-mono);
    font-weight: 500;
  }

  .fields { display: flex; flex-direction: column; gap: var(--space-3); }

  .field-inline { display: flex; flex-direction: column; gap: var(--space-1); }
  .field-label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .field-value { color: var(--accent); }

  .input-wrap {
    display: flex;
    align-items: center;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .input-wrap:focus-within { border-color: var(--accent); }
  .input-suffix {
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    border-left: 1px solid var(--border-subtle);
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

  .num-input-bare {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    width: 100%;
    box-sizing: border-box;
  }
  .num-input-bare:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

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

  /* Result display */
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

  .result-value {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--accent);
    line-height: 1.1;
    letter-spacing: -0.03em;
    word-break: break-all;
  }

  .result-explain {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    line-height: 1.5;
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
