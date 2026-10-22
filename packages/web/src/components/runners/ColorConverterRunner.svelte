<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolModule } from '@wyreup/core';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { PreloadAdmission, SerializedTool } from './types';

  // Live color-converter — type any color string and see it as a swatch
  // plus every standard format with copy buttons. Pure passthrough to
  // the core tool's run() (which drives culori) on every keystroke;
  // result is always rebuilt so the chain panel and download stay
  // in sync with what's on screen.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedTool: ToolModule<Record<string, never>> | undefined = undefined;
  export let showChain = true;

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
    alpha: number | null;
    gamut: 'srgb' | 'outside-srgb' | null;
    opaquePickerHex: string;
  }

  let inputColor = '#ffb000';
  let preloadBlocked = !!preloadedFile;
  let pickerHex = '#ffb000';
  let pickerIntent: string | null = null;
  let result: ConvertResult | null = null;
  let resultBlob: Blob | null = null;
  let copied: string | null = null;
  let errorMsg = '';
  let notice = '';
  let generation = 0;
  let controller: AbortController | null = null;
  let destroyed = false;
  const urls = new Set<string>();
  let observedPreload: File | null = null;
  let preloadCandidate: File | null = null;
  let candidateValue = '';
  const attemptedPreloads = new WeakSet<File>();

  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  $: if (!preloadBlocked) void recompute(inputColor);
  function report(file: File, status: 'admitted' | 'refused') {
    if (!destroyed && file === preloadedFile)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'Color input was not interpreted as a valid color.' });
  }
  function discardCandidate() {
    if (preloadCandidate) report(preloadCandidate, 'refused');
    preloadCandidate = null;
  }

  async function recompute(value: string) {
    const ownPreload = preloadCandidate && candidateValue === value ? preloadCandidate : null;
    const ownTool = tool;
    const own = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    result = null;
    resultBlob = null;
    copied = null;
    notice = '';
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    errorMsg = '';
    if (!value.trim() && !ownPreload) {
      result = null;
      resultBlob = null;
      return;
    }
    try {
      if (new TextEncoder().encode(value).length > 1024) throw new Error('Color input exceeds 1 KiB.');
      const file = new File([value], 'color.txt', { type: 'text/plain' });
      const toolModule = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (destroyed || own !== generation || ownTool !== tool || signal.aborted) return;
      if (!toolModule) throw new Error('Color converter unavailable.');
      const blobs = await toolModule.run([file], {}, {
        onProgress: () => {},
        signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (destroyed || own !== generation || ownTool !== tool || signal.aborted) return;
      if (!blob) throw new Error('Color converter returned no result.');
      const converted = JSON.parse(await blob.text()) as ConvertResult;
      if (destroyed || own !== generation || ownTool !== tool || signal.aborted) return;
      resultBlob = blob;
      result = converted;
      if (converted.valid && converted.opaquePickerHex) {
        pickerHex = converted.opaquePickerHex;
        if (pickerIntent === value)
          notice = 'Picker edits replace the source with an opaque sRGB color, including any alpha or wide-gamut color.';
      }
      pickerIntent = null;
      markToolUsed(tool.id);
      if (ownPreload && ownPreload === preloadCandidate) {
        report(ownPreload, converted.valid ? 'admitted' : 'refused');
        preloadCandidate = null;
      }
    } catch (err) {
      if (destroyed || own !== generation || ownTool !== tool) return;
      result = null;
      resultBlob = null;
      errorMsg = err instanceof Error ? err.message : String(err);
      if (ownPreload && ownPreload === preloadCandidate) { report(ownPreload, 'refused'); preloadCandidate = null; }
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
    const own = generation;
    try {
      await navigator.clipboard.writeText(value);
      if (destroyed || own !== generation) return;
      copied = label;
      notice = `Copied ${label}.`;
    } catch { if (!destroyed && own === generation) notice = 'Copy unavailable. Use Download JSON.'; }
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    urls.add(a.href);
    a.download = buildDownloadName(undefined, tool.id, 'json');
    a.click();
  }

  function pick(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (value !== inputColor || preloadBlocked) discardCandidate();
    pickerHex = value;
    pickerIntent = value;
    preloadBlocked = false;
    if (inputColor === value && result?.valid) {
      notice = 'Picker edits replace the source with an opaque sRGB color, including any alpha or wide-gamut color.';
      pickerIntent = null;
    }
    inputColor = value;
  }
  function typed(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (value === inputColor && !preloadBlocked) return;
    discardCandidate();
    generation++;
    controller?.abort();
    pickerIntent = null;
    preloadBlocked = false;
    inputColor = value;
  }
  function preloadFailed(message: string) {
    generation++;
    controller?.abort();
    result = null;
    resultBlob = null;
    copied = null;
    notice = '';
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    errorMsg = message;
  }
  function stagePreload(file: File | null) {
    observedPreload = file;
    discardCandidate();
    preloadFailed(''); preloadBlocked = true;
    if (!file) { inputColor = ''; return; }
    if (attemptedPreloads.has(file)) { errorMsg = 'This file was already attempted. Use Retry to load it again.'; return; }
    attemptedPreloads.add(file);
    const own = generation, ownTool = tool;
    preloadCandidate = file;
    void (async () => {
      try {
        if (file.size > 1024) throw new Error('Color input exceeds 1 KiB.');
        const bytes = await file.slice(0, 1025).arrayBuffer();
        if (destroyed || own !== generation || ownTool !== tool || preloadedFile !== file) return;
        if (bytes.byteLength > 1024) throw new Error('Color input exceeds 1 KiB.');
        const value = new TextDecoder().decode(bytes);
        candidateValue = value; inputColor = value; preloadBlocked = false;
      } catch (cause) {
        if (!destroyed && own === generation && ownTool === tool && preloadedFile === file) {
          preloadFailed(cause instanceof Error && cause.message === 'Color input exceeds 1 KiB.' ? cause.message : 'Unable to read color input.');
          report(file, 'refused'); preloadCandidate = null;
        }
      }
    })();
  }
  onDestroy(() => { destroyed = true; generation++; controller?.abort();
    for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });

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
    const ss = Math.round(s);
    const ll = Math.round(l);
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
      value={pickerHex}
      on:input={pick}
      aria-label="Color picker"
    />
    <input
      id="color-input-text"
      class="input-row__text"
      type="text"
      value={inputColor}
      on:input={typed}
      placeholder="any: #ffb000, rgb(255,176,0), hsl(41 100% 50%), tomato"
      spellcheck="false"
      aria-label="Color string"
    />
  </div>

  <p>The picker shows an opaque sRGB approximation. Typing an advanced CSS color preserves its source and alpha.</p>
  {#if notice}<p role="status">{notice}</p>{/if}

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
          <p>Alpha: {result.alpha}. Gamut: {result.gamut}.</p>
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

        {#if resultBlob && showChain}
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
