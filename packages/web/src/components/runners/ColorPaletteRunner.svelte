<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { acquireWakeLock, releaseWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // Visual runner for color-palette: shows extracted colors as chips
  // (the obvious view) and keeps the raw JSON one click away for users
  // who want to copy / download / pipe it programmatically.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface ColorPaletteResult {
    vibrant: string | null;
    muted: string | null;
    darkVibrant: string | null;
    darkMuted: string | null;
    lightVibrant: string | null;
    lightMuted: string | null;
    topColors: string[];
  }

  const NAMED_SLOTS: Array<[keyof ColorPaletteResult, string]> = [
    ['vibrant', 'Vibrant'],
    ['muted', 'Muted'],
    ['darkVibrant', 'Dark Vibrant'],
    ['darkMuted', 'Dark Muted'],
    ['lightVibrant', 'Light Vibrant'],
    ['lightMuted', 'Light Muted'],
  ];

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlob: Blob | null = null;
  let result: ColorPaletteResult | null = null;
  let showJson = false;
  let copied: string | null = null;

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }
  $: canRun = files.length >= tool.input.min && state !== 'running';

  // Convenience: contrast text color for a swatch — black on light, white on dark.
  function contrastFor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Perceived luminance (Rec. 709)
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.55 ? '#111113' : '#fafafa';
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    result = null;
    resultBlob = null;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    result = null;
    resultBlob = null;

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const blobs = await toolModule.run(files, params, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const list = Array.isArray(blobs) ? blobs : [blobs];
      const blob = list[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      const text = await blob.text();
      result = JSON.parse(text) as ColorPaletteResult;
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      releaseWakeLock();
    }
  }

  function reset() {
    state = 'idle';
    errorMsg = '';
    result = null;
    resultBlob = null;
  }

  async function copyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      copied = hex;
      setTimeout(() => { if (copied === hex) copied = null; }, 1200);
    } catch { /* ignore */ }
  }

  async function copyAllHex() {
    if (!result) return;
    const all = result.topColors.join(' ');
    try {
      await navigator.clipboard.writeText(all);
      copied = 'all';
      setTimeout(() => { if (copied === 'all') copied = null; }, 1200);
    } catch { /* ignore */ }
  }

  async function copyCssVars() {
    if (!result) return;
    const lines: string[] = [];
    for (const [key, label] of NAMED_SLOTS) {
      const val = result[key] as string | null;
      if (val) lines.push(`  --color-${label.toLowerCase().replace(/\s+/g, '-')}: ${val};`);
    }
    result.topColors.forEach((c, i) => {
      lines.push(`  --color-${i + 1}: ${c};`);
    });
    const css = `:root {\n${lines.join('\n')}\n}`;
    try {
      await navigator.clipboard.writeText(css);
      copied = 'css';
      setTimeout(() => { if (copied === 'css') copied = null; }, 1200);
    } catch { /* ignore */ }
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

  <ParamsForm
    defaults={tool.defaults}
    paramSchema={tool.paramSchema}
    bind:params
    on:change={(e) => { params = e.detail; }}
  />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? 'Extract again' : 'Extract palette'}
    </button>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert">
      <div class="panel-header"><span class="panel-label error-label">Error</span></div>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" on:click={reset} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && result}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Palette</span>
          <div class="result-actions">
            <button class="btn-secondary" on:click={copyAllHex} type="button">
              {copied === 'all' ? 'Copied' : 'Copy all hex'}
            </button>
            <button class="btn-secondary" on:click={copyCssVars} type="button">
              {copied === 'css' ? 'Copied' : 'Copy CSS vars'}
            </button>
            <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
          </div>
        </div>
        <div class="panel-divider"></div>

        <!-- Top colors strip -->
        <div class="strip" aria-label="Top colors">
          {#each result.topColors as hex (hex)}
            <button
              class="strip__chip"
              style="background: {hex}; color: {contrastFor(hex)};"
              on:click={() => copyHex(hex)}
              title="Click to copy {hex}"
              type="button"
              aria-label={`Copy ${hex}`}
            >
              <span class="strip__hex">{copied === hex ? 'copied' : hex}</span>
            </button>
          {/each}
        </div>

        <!-- Named swatches grid -->
        <div class="named-grid" aria-label="Named swatches">
          {#each NAMED_SLOTS as [key, label]}
            {@const hex = result[key]}
            {#if hex}
              <button
                class="named-chip"
                style="background: {hex}; color: {contrastFor(hex)};"
                on:click={() => copyHex(hex)}
                title="Click to copy {hex}"
                type="button"
                aria-label={`Copy ${label} ${hex}`}
              >
                <span class="named-chip__label">{label}</span>
                <span class="named-chip__hex">{copied === hex ? 'copied' : hex}</span>
              </button>
            {/if}
          {/each}
        </div>

        <!-- Optional raw JSON drawer -->
        <details class="json-drawer" open={showJson}>
          <summary on:click={() => { showJson = !showJson; }}>
            {showJson ? 'Hide' : 'Show'} raw JSON
          </summary>
          <pre class="json-view">{JSON.stringify(result, null, 2)}</pre>
        </details>

        {#if resultBlob}
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(files[0]?.name, tool.id, 'json')}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

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
    transition: background var(--duration-instant) var(--ease-sharp), transform var(--duration-instant) var(--ease-sharp);
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }
  .panel-divider { height: 1px; background: var(--border-subtle); }
  .result-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; overflow: visible; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }

  /* Strip — full-bleed bar of top colors */
  .strip {
    display: flex;
    border-radius: var(--radius-sm);
    overflow: hidden;
    height: 64px;
    border: 1px solid var(--border-subtle);
  }

  .strip__chip {
    flex: 1;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: var(--space-1);
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

  /* Named swatches grid */
  .named-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
  }

  .named-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    min-height: 80px;
    text-align: left;
    transition: filter var(--duration-instant) var(--ease-sharp);
  }

  .named-chip:hover { filter: brightness(1.08); }
  .named-chip:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .named-chip__label {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.85;
  }

  .named-chip__hex {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  /* JSON drawer */
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
