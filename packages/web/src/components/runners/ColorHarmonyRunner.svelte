<script lang="ts">
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ColorHarmonyResult, HarmonyScheme } from '@wyreup/core';

  // Live color-harmony runner. The user types or picks a base color
  // and every scheme updates in real time — no "Run" press needed for
  // a math-only tool. Result blob is rebuilt for download / chain
  // whenever the base changes.

  export let tool: SerializedTool;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let preloadedFile: File | null = null;

  const SCHEME_LABELS: Record<HarmonyScheme, string> = {
    complementary: 'Complementary',
    analogous: 'Analogous',
    triadic: 'Triadic',
    tetradic: 'Tetradic',
    'split-complementary': 'Split-complementary',
    monochromatic: 'Monochromatic',
  };

  const SCHEME_ORDER: HarmonyScheme[] = [
    'complementary',
    'analogous',
    'triadic',
    'tetradic',
    'split-complementary',
    'monochromatic',
  ];

  let baseColor: string = (tool.defaults?.color as string | undefined) ?? '#ffb000';
  let result: ColorHarmonyResult | null = null;
  let resultBlob: Blob | null = null;
  let errorMsg = '';
  let copied: string | null = null;

  // Live recompute. Cheap (pure math), so no debounce needed.
  $: void recompute(baseColor);

  async function recompute(color: string) {
    errorMsg = '';
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) return;

      const blobs = await toolModule.run([], { color }, {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) return;
      resultBlob = blob;
      const text = await blob.text();
      result = JSON.parse(text) as ColorHarmonyResult;
      markToolUsed(tool.id);
    } catch (err) {
      result = null;
      resultBlob = null;
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function contrastFor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.55 ? '#111113' : '#fafafa';
  }

  async function copyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      copied = hex;
      setTimeout(() => { if (copied === hex) copied = null; }, 1200);
    } catch { /* ignore */ }
  }

  async function copySchemeHex(scheme: HarmonyScheme) {
    if (!result) return;
    const hex = result.schemes[scheme].join(' ');
    try {
      await navigator.clipboard.writeText(hex);
      copied = `scheme:${scheme}`;
      setTimeout(() => { if (copied === `scheme:${scheme}`) copied = null; }, 1200);
    } catch { /* ignore */ }
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(undefined, tool.id, 'json');
    a.click();
  }
</script>

<div class="runner">
  <div class="input-row">
    <label class="input-row__label" for="base-color-text">Base color</label>
    <input
      id="base-color-picker"
      class="input-row__picker"
      type="color"
      bind:value={baseColor}
      aria-label="Color picker"
    />
    <input
      id="base-color-text"
      class="input-row__text"
      type="text"
      bind:value={baseColor}
      placeholder="#ffb000"
      spellcheck="false"
      aria-label="Hex color"
    />
  </div>

  {#if errorMsg && !result}
    <div class="error-panel" role="alert">
      <p class="error-msg">{errorMsg}</p>
    </div>
  {/if}

  {#if result}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Schemes for {result.base}</span>
          <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
        </div>
        <div class="panel-divider"></div>

        {#each SCHEME_ORDER as scheme}
          {@const colors = result.schemes[scheme]}
          <div class="scheme">
            <div class="scheme__header">
              <span class="scheme__label">{SCHEME_LABELS[scheme]}</span>
              <button
                class="btn-ghost-sm"
                on:click={() => copySchemeHex(scheme)}
                type="button"
              >
                {copied === `scheme:${scheme}` ? 'Copied' : 'Copy hex'}
              </button>
            </div>
            <div class="scheme__strip" role="list">
              {#each colors as hex}
                <button
                  class="strip__chip"
                  style="background: {hex}; color: {contrastFor(hex)};"
                  on:click={() => copyHex(hex)}
                  title="Click to copy {hex}"
                  type="button"
                  role="listitem"
                  aria-label={`Copy ${hex}`}
                >
                  <span class="strip__hex">{copied === hex ? 'copied' : hex}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}

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
  }

  .input-row__text:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

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

  .btn-ghost-sm {
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
  .btn-ghost-sm:hover { color: var(--text-primary); }

  .error-panel {
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-3) var(--space-4);
  }

  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--danger);
    margin: 0;
  }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .scheme {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .scheme__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .scheme__label {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .scheme__strip {
    display: flex;
    border-radius: var(--radius-sm);
    overflow: hidden;
    height: 56px;
    border: 1px solid var(--border-subtle);
  }

  .strip__chip {
    flex: 1;
    border: none;
    cursor: pointer;
    padding: 0 0 var(--space-1);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    transition: filter var(--duration-instant) var(--ease-sharp);
  }
  .strip__chip:hover { filter: brightness(1.1); }
  .strip__chip:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: -2px; z-index: 1; }

  .strip__hex {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

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
