<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  const requiresFile = tool.input.min > 0;

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let params: Record<string, unknown> = { ...tool.defaults };
  let dropError = '';

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultText = '';
  let resultMime = '';
  let resultBlob: Blob | null = null;

  $: if (preloadedFile && files.length === 0) {
    files = [preloadedFile];
  }

  $: canRun = (requiresFile ? files.length >= tool.input.min : true) && state !== 'running';
  $: isHtml = resultMime === 'text/html';

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    resultText = '';
    resultBlob = null;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    resultText = '';

    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run(files, params, {
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
      resultText = await blob.text();
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
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

  // Tier-0 TTS via Web Speech API (Wave Q). OS-provided voices,
  // no download, playback-only.
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
    const ext = resultMime.includes('html') ? 'html' : 'txt';
    a.download = buildDownloadName(files[0]?.name, tool.id, ext);
    a.click();
  }
</script>

<div class="runner">
  {#if requiresFile}
    <DropZone
      accept={tool.input.accept}
      multiple={false}
      bind:files
      bind:error={dropError}
      on:files={onFiles}
    />
  {/if}

  <ParamsForm defaults={tool.defaults} paramSchema={tool.paramSchema} bind:params on:change={(e) => { params = e.detail; }} />

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
            {#if speakSupported && !isHtml}
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
          <pre
            class="text-viewer"
            class:text-viewer--prose={tool.outputDisplay === 'prose'}
            role="region"
            aria-label="Text result"
          >{resultText}</pre>
          {#if tool.outputDisplay === 'prose' && resultText}
            <p class="text-stats">
              {resultText.length.toLocaleString()} characters ·
              {resultText.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words
            </p>
          {/if}
        {/if}

        {#if resultBlob}
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(files[0]?.name, tool.id, resultMime.includes('html') ? 'html' : 'txt')}
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

  /* Prose mode for transcripts, captions, summaries — readable, not
     code. Larger / sans-serif / generous line height. */
  .text-viewer--prose {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    line-height: 1.7;
    padding: var(--space-4);
    max-height: 540px;
  }

  .text-stats {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
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
