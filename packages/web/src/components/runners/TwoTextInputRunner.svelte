<script lang="ts">
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { acquireWakeLock, releaseWakeLock } from '../../lib/wakeLock';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  // Two side-by-side textareas. Wraps each into a synthetic File so the
  // existing tool runtime (which expects File[]) works unchanged.
  let textA = '';
  let textB = '';
  let params: Record<string, unknown> = { ...tool.defaults };

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlob: Blob | null = null;
  let resultText = '';
  let resultMime = '';

  // Chain hand-off: if a single file was piped in, drop it into the first
  // textarea so the user can paste the second half manually.
  let preloadConsumed = false;
  $: if (preloadedFile && !preloadConsumed) {
    preloadConsumed = true;
    void preloadedFile.text().then((t) => {
      textA = t;
    });
  }

  $: canRun =
    textA.trim().length > 0 &&
    textB.trim().length > 0 &&
    state !== 'running';
  $: isJson =
    resultMime === 'application/json' || resultMime.endsWith('+json');
  $: isHtml = resultMime === 'text/html';

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    resultText = '';
    resultBlob = null;

    const fileA = new File([textA], 'a.txt', { type: 'text/plain' });
    const fileB = new File([textB], 'b.txt', { type: 'text/plain' });

    void acquireWakeLock();
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run([fileA, fileB], params, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      resultMime = blob.type;
      const raw = await blob.text();
      resultText = isJsonMime(blob.type) ? prettifyJson(raw) : raw;
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      releaseWakeLock();
    }
  }

  function isJsonMime(m: string) {
    return m === 'application/json' || m.endsWith('+json');
  }

  function prettifyJson(s: string) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  }

  function reset() {
    state = 'idle';
    errorMsg = '';
    resultText = '';
    resultBlob = null;
  }

  let copied = false;

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(resultText);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch { /* ignore */ }
  }

  function download() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    const ext = isJson ? 'json' : isHtml ? 'html' : 'txt';
    a.download = buildDownloadName(undefined, tool.id, ext);
    a.click();
  }

  function swap() {
    const t = textA;
    textA = textB;
    textB = t;
  }
</script>

<div class="runner">
  <div class="dual-input">
    <div class="text-pane">
      <div class="text-pane__header">
        <span class="text-pane__label">A</span>
        {#if textA}
          <button class="btn-ghost-sm" on:click={() => { textA = ''; }} type="button">Clear</button>
        {/if}
      </div>
      <textarea
        class="text-pane__textarea"
        bind:value={textA}
        placeholder="First text…"
        rows="8"
        spellcheck="false"
      ></textarea>
    </div>
    <div class="dual-input__divider">
      <button class="btn-swap" on:click={swap} type="button" aria-label="Swap A and B" title="Swap">⇄</button>
    </div>
    <div class="text-pane">
      <div class="text-pane__header">
        <span class="text-pane__label">B</span>
        {#if textB}
          <button class="btn-ghost-sm" on:click={() => { textB = ''; }} type="button">Clear</button>
        {/if}
      </div>
      <textarea
        class="text-pane__textarea"
        bind:value={textB}
        placeholder="Second text…"
        rows="8"
        spellcheck="false"
      ></textarea>
    </div>
  </div>

  <ParamsForm
    defaults={tool.defaults}
    paramSchema={tool.paramSchema}
    bind:params
    on:change={(e) => { params = e.detail; }}
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
      <div class="panel-header"><span class="panel-label error-label">Error</span></div>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" on:click={reset} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && resultText}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
          <div class="result-actions">
            <button class="btn-secondary" on:click={copyResult} type="button">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button class="btn-secondary" on:click={download} type="button">Download</button>
          </div>
        </div>
        <div class="panel-divider"></div>

        {#if isHtml}
          <div class="html-viewer" role="region" aria-label="HTML result">
            {@html resultText}
          </div>
        {:else}
          <pre class="text-viewer" role="region" aria-label={isJson ? 'JSON result' : 'Text result'}>{resultText}</pre>
        {/if}

        {#if resultBlob}
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(undefined, tool.id, isJson ? 'json' : isHtml ? 'html' : 'txt')}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

  .dual-input {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: var(--space-2);
    align-items: stretch;
  }

  @media (max-width: 700px) {
    .dual-input {
      grid-template-columns: 1fr;
    }
    .dual-input__divider {
      grid-row: auto;
      justify-self: center;
    }
  }

  .text-pane {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .text-pane__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
  }

  .text-pane__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .text-pane__textarea {
    width: 100%;
    box-sizing: border-box;
    border: none;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-3);
    resize: vertical;
    min-height: 160px;
    line-height: 1.5;
    outline: none;
    flex: 1;
  }

  .text-pane__textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .dual-input__divider {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-1);
  }

  .btn-swap {
    height: 28px;
    width: 28px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: color var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-swap:hover { color: var(--accent); border-color: var(--accent); }
  .btn-swap:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .btn-ghost-sm {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }
  .btn-ghost-sm:hover { color: var(--text-muted); }
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
  .btn-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .error-label { color: var(--danger); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; }
  .panel-divider { height: 1px; background: var(--border-subtle); }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; overflow: visible; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .result-actions { display: flex; gap: var(--space-2); }

  .text-viewer {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
    line-height: 1.5;
    margin: 0;
  }

  .html-viewer {
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    max-height: 400px;
    overflow-y: auto;
    font-size: var(--text-sm);
    color: var(--text-primary);
    line-height: 1.6;
  }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent); border-left: 1px solid var(--accent); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-left: 1px solid var(--accent); }
</style>
