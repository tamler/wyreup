<script lang="ts">
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  let inputText = '';
  let params: Record<string, unknown> = { ...tool.defaults };

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlob: Blob | null = null;
  let resultText = '';
  let resultMime = '';

  // Chained-from-prior-tool: read its bytes into the textarea so the user
  // can edit before running.
  let preloadConsumed = false;
  $: if (preloadedFile && !preloadConsumed) {
    preloadConsumed = true;
    void preloadedFile.text().then((t) => {
      inputText = t;
    });
  }

  $: canRun = inputText.trim().length > 0 && state !== 'running';
  $: isHtml = resultMime === 'text/html';
  $: isJson =
    resultMime === 'application/json' || resultMime.endsWith('+json');

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    resultText = '';
    resultBlob = null;

    const file = new File([inputText], 'input.txt', { type: 'text/plain' });

    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run([file], params, {
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
      resultText = isJsonMime(blob.type)
        ? prettifyJson(await blob.text())
        : await blob.text();
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
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

  function clearInput() {
    inputText = '';
    reset();
  }

  let copied = false;

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(resultText);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch { /* ignore */ }
  }

  // Tier-0 TTS via Web Speech API. Browser/OS provides the voices —
  // no model download, no network. Playback only (the Web Speech API
  // doesn't expose the waveform).
  let speakSupported = false;
  let speaking = false;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speakSupported = true;
  }

  function speak(text: string) {
    if (!speakSupported || !text) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      speaking = false;
      return;
    }
    const utt = new SpeechSynthesisUtterance(text);
    utt.onend = () => { speaking = false; };
    utt.onerror = () => { speaking = false; };
    synth.speak(utt);
    speaking = true;
  }

  function download() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    const ext = isJson ? 'json' : isHtml ? 'html' : 'txt';
    a.download = buildDownloadName(undefined, tool.id, ext);
    a.click();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Cmd/Ctrl+Enter runs the tool.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  }

  $: charCount = inputText.length;
</script>

<div class="runner">
  <div class="text-input">
    <div class="text-input__header">
      <span class="text-input__label">Input</span>
      <div class="text-input__meta">
        <span class="text-input__count">{charCount.toLocaleString()} char{charCount === 1 ? '' : 's'}</span>
        {#if inputText}
          <button class="btn-ghost-sm" on:click={clearInput} type="button">Clear</button>
        {/if}
      </div>
    </div>
    <textarea
      class="text-input__textarea"
      bind:value={inputText}
      on:keydown={handleKeydown}
      placeholder={`Type or paste text here. Cmd/Ctrl+Enter to run ${tool.name}.`}
      rows="8"
      spellcheck="false"
    ></textarea>
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
            {#if speakSupported && !isHtml && !isJson}
              <button class="btn-secondary" on:click={() => speak(resultText)} type="button" aria-label={speaking ? 'Stop speaking' : 'Speak this text aloud'}>
                {speaking ? 'Stop' : 'Speak'}
              </button>
            {/if}
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

  .text-input {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    overflow: hidden;
  }

  .text-input__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
  }

  .text-input__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .text-input__meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .text-input__count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .text-input__textarea {
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
  }

  .text-input__textarea:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: -2px;
  }

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
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
    font-size: var(--text-base);
    font-weight: 500;
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
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
</style>
