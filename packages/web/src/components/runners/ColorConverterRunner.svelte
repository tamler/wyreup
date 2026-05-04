<script lang="ts">
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';

  // Live color-converter — type any color string and see it as a swatch
  // plus every standard format with copy buttons. Pure passthrough to
  // the core tool's run() (which drives culori) on every keystroke;
  // result is always rebuilt so the chain panel and download stay
  // in sync with what's on screen.

  export let tool: SerializedTool;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let preloadedFile: File | null = null;

  interface ConvertResult {
    input: string;
    hex: string;
    rgb: { r: number; g: number; b: number; a?: number };
    rgbString: string;
    hsl: { h: number; s: number; l: number; a?: number };
    hslString: string;
    oklch: { l: number; c: number; h: number };
    oklchString: string;
    oklab: { l: number; a: number; b: number };
    valid: boolean;
  }

  let inputColor = '#ffb000';
  let result: ConvertResult | null = null;
  let resultBlob: Blob | null = null;
  let copied: string | null = null;
  let errorMsg = '';

  $: void recompute(inputColor);

  async function recompute(value: string) {
    errorMsg = '';
    if (!value.trim()) {
      result = null;
      resultBlob = null;
      return;
    }
    try {
      const file = new File([value], 'color.txt', { type: 'text/plain' });
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) return;
      const blobs = await toolModule.run([file], {}, {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) return;
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as ConvertResult;
      markToolUsed(tool.id);
    } catch (err) {
      result = null;
      resultBlob = null;
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function contrastFor(hex: string): string {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return '#fafafa';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.55 ? '#111113' : '#fafafa';
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = label;
      setTimeout(() => { if (copied === label) copied = null; }, 1200);
    } catch { /* ignore */ }
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(undefined, tool.id, 'json');
    a.click();
  }

  // Round per-format helpers
  function rgbCanonical(r: ConvertResult): string {
    const { r: red, g, b, a } = r.rgb;
    const round = (n: number) => Math.round(n);
    return a !== undefined && a !== 1
      ? `rgba(${round(red)}, ${round(g)}, ${round(b)}, ${a})`
      : `rgb(${round(red)}, ${round(g)}, ${round(b)})`;
  }

  function hslCanonical(r: ConvertResult): string {
    const { h, s, l, a } = r.hsl;
    const hh = Math.round(h);
    const ss = Math.round(s * 100);
    const ll = Math.round(l * 100);
    return a !== undefined && a !== 1
      ? `hsla(${hh}, ${ss}%, ${ll}%, ${a})`
      : `hsl(${hh}, ${ss}%, ${ll}%)`;
  }
</script>

<div class="runner">
  <div class="input-row">
    <label class="input-row__label" for="color-input-text">Color</label>
    <input
      class="input-row__picker"
      type="color"
      bind:value={inputColor}
      aria-label="Color picker"
    />
    <input
      id="color-input-text"
      class="input-row__text"
      type="text"
      bind:value={inputColor}
      placeholder="any: #ffb000, rgb(255,176,0), hsl(41 100% 50%), tomato"
      spellcheck="false"
      aria-label="Color string"
    />
  </div>

  {#if errorMsg && !result}
    <div class="error-panel" role="alert">
      <p class="error-msg">{errorMsg}</p>
    </div>
  {/if}

  {#if result && result.valid}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div
          class="swatch"
          style="background: {result.hex}; color: {contrastFor(result.hex)};"
        >
          <span class="swatch__hex">{result.hex}</span>
          <span class="swatch__sub">interpreted from <code>{result.input}</code></span>
        </div>

        <div class="formats">
          {#each [
            { label: 'HEX', value: result.hex },
            { label: 'RGB', value: rgbCanonical(result) },
            { label: 'HSL', value: hslCanonical(result) },
            { label: 'OKLCH', value: result.oklchString },
          ] as f}
            <div class="format-row">
              <span class="format-row__label">{f.label}</span>
              <code class="format-row__value">{f.value}</code>
              <button
                class="format-row__copy"
                on:click={() => copy(f.label, f.value)}
                type="button"
                aria-label={`Copy ${f.label}`}
              >{copied === f.label ? 'Copied' : 'Copy'}</button>
            </div>
          {/each}
        </div>

        <div class="result-actions">
          <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
        </div>

        <details class="json-drawer">
          <summary>Show raw JSON</summary>
          <pre class="json-view">{JSON.stringify(result, null, 2)}</pre>
        </details>

        {#if resultBlob}
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(undefined, tool.id, 'json')}
          />
        {/if}
      </div>
    </div>
  {:else if result && !result.valid}
    <p class="hint">Couldn't parse that color. Try a hex (`#ffb000`), an `rgb()`, an `hsl()`, or a CSS named color.</p>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

  .input-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .input-row__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .input-row__picker {
    width: 40px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }

  .input-row__text {
    flex: 1;
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    min-width: 0;
  }

  .input-row__text:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-3) var(--space-4); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--danger); margin: 0; }

  .hint {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    margin: 0;
  }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }

  .swatch {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-6) var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    text-align: center;
    align-items: center;
    justify-content: center;
    min-height: 120px;
  }

  .swatch__hex {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .swatch__sub {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.85;
  }

  .swatch__sub code {
    font-family: var(--font-mono);
    background: rgba(0, 0, 0, 0.15);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }

  .formats { display: flex; flex-direction: column; gap: var(--space-1); }

  .format-row {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .format-row__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-text);
    font-weight: 500;
  }

  .format-row__value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .format-row__copy {
    height: 24px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }
  .format-row__copy:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .result-actions { display: flex; gap: var(--space-2); }

  .btn-secondary {
    height: 28px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }

  .json-drawer summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    list-style: none;
    padding: var(--space-1) 0;
  }
  .json-drawer summary:hover { color: var(--text-muted); }
  .json-drawer summary::-webkit-details-marker { display: none; }

  .json-view {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow: auto;
    max-height: 280px;
    white-space: pre-wrap;
    margin: var(--space-2) 0 0;
    line-height: 1.5;
  }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
</style>
