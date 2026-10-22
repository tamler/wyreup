<script lang="ts">
  import { onDestroy } from 'svelte';
  import DropZone from './DropZone.svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import DOMPurify from 'dompurify';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool, PreloadAdmission } from './types';
  import type { ToolModule, ToolProgress } from '@wyreup/core';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedTool: ToolModule<Record<string, unknown>> | null = null;
  export let showChain = true;

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
  let previewLimited = false;
  let decodedDownloadOnly = false;
  let forcePlainText = false;
  let resultExtension = 'txt';
  let controller: AbortController | null = null;
  let generation = 0;
  const urls = new Set<string>();
  let copied = false;
  let copyNotice = '';
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPreloaded = preloadedFile;
  let disposed = false;
  let activePreload: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  if (preloadedFile) attemptedPreloads.add(preloadedFile);
  function reportPreload(file: File | null, status: 'admitted' | 'refused') {
    if (!disposed && file && file === preloadedFile && files.includes(file)) {
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'The file input was not interpreted by this tool.' });
    }
  }

  $: if (preloadedFile !== lastPreloaded) {
    lastPreloaded = preloadedFile;
    invalidate();
    files = preloadedFile && !attemptedPreloads.has(preloadedFile) ? [preloadedFile] : [];
    if (preloadedFile) attemptedPreloads.add(preloadedFile);
  }

  $: canRun = (requiresFile ? files.length >= tool.input.min : true) && state !== 'running';
  $: isHtml = resultMime === 'text/html' && !forcePlainText;
  // Tool output is user-derived (file content / typed params). When the
  // tool emits text/html we render it with {@html}, so anything
  // <script>-shaped from a hostile input would otherwise run with
  // wyreup.com's privileges (including the admin session cookie).
  // DOMPurify strips scripts, event handlers, and javascript: URLs.
  $: safeHtml = isHtml ? DOMPurify.sanitize(resultText) : '';

  function onFiles(e: CustomEvent<File[]>) {
    invalidate();
    files = e.detail;
    dropError = '';
  }

  function stopSpeech() {
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
      if (speaking) window.speechSynthesis.cancel();
      utterance = null;
    }
    speaking = false;
  }

  function invalidate() {
    reportPreload(activePreload, 'refused');
    activePreload = null;
    generation++;
    controller?.abort();
    controller = null;
    state = 'idle';
    errorMsg = '';
    resultText = '';
    resultMime = '';
    resultBlob = null;
    previewLimited = false;
    decodedDownloadOnly = false;
    forcePlainText = false;
    copied = false;
    copyNotice = '';
    clearTimeout(copyTimer);
    stopSpeech();
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  }

  function parametersChanged(e: CustomEvent<Record<string, unknown>>) {
    invalidate();
    params = e.detail;
  }

  async function run() {
    if (!canRun) return;
    invalidate();
    const own = ++generation;
    const abort = new AbortController();
    controller = abort;
    const inputFiles = [...files];
    const ownTool = tool;
    const ownId = tool.id;
    const ownInjected = injectedTool;
    activePreload = preloadedFile && inputFiles.includes(preloadedFile) ? preloadedFile : null;
    const current = () => !disposed && own === generation && !abort.signal.aborted && tool === ownTool && tool.id === ownId && injectedTool === ownInjected;
    const inputParams = { ...params };
    if (tool.id === 'base64' && inputParams.mode === 'decode') delete inputParams.encodeOutput;
    state = 'running';
    progress = { stage: 'processing', percent: 0, message: '' };
    errorMsg = '';
    resultText = '';

    try {
      let toolModule = injectedTool;
      if (!toolModule) {
        const { createDefaultRegistry } = await import('../../lib/core-execution');
        toolModule = createDefaultRegistry().toolsById.get(tool.id) ?? null;
      }
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);
      if (!current()) return;

      const result = await toolModule.run(inputFiles, inputParams, {
        onProgress: (p) => { if (current()) progress = p; },
        signal: abort.signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');
      if (!current()) return;
      const imageOutput = tool.id === 'base64' && inputParams.mode === 'encode' &&
        (inputParams.encodeOutput === 'data-url' || inputParams.encodeOutput === 'css-url');
      const decodedOutput = tool.id === 'base64' && inputParams.mode === 'decode';
      let limited = (imageOutput || decodedOutput) && blob.size > 256 * 1024;
      let text = '';
      if (decodedOutput && !limited) {
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer()); }
        catch { limited = true; }
      } else if (!limited) text = await blob.text();
      if (!current()) return;

      resultBlob = blob;
      resultMime = blob.type;
      resultText = text;
      previewLimited = limited;
      decodedDownloadOnly = decodedOutput && limited;
      forcePlainText = decodedOutput;
      resultExtension = tool.id === 'base64' && inputParams.mode === 'decode' ? 'bin' :
        tool.id === 'csv-json' && inputParams.direction === 'csv-to-csv' ? 'csv' :
        blob.type.includes('html') ? 'html' : 'txt';
      markToolUsed(tool.id);
      state = 'done';
      reportPreload(activePreload, 'admitted');
      activePreload = null;
    } catch (err) {
      if (!current()) return;
      reportPreload(activePreload, 'refused');
      activePreload = null;
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      if (own === generation) { controller = null; activePreload = null; }
    }
  }

  function reset() {
    invalidate();
  }

  async function copyResult() {
    if (!resultBlob || previewLimited) return;
    const own = generation;
    try {
      await navigator.clipboard.writeText(resultText);
      if (own !== generation) return;
      copied = true;
      copyNotice = '';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { if (own === generation) copied = false; }, 1500);
    } catch {
      if (own === generation) copyNotice = 'Copy unavailable. Download the result instead.';
    }
  }

  // Tier-0 TTS via Web Speech API (Wave Q). OS-provided voices,
  // no download, playback-only.
  let speakSupported = false;
  let speaking = false;
  let utterance: SpeechSynthesisUtterance | null = null;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speakSupported = true;
  }

  function speak(text: string) {
    if (!speakSupported || !text) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      stopSpeech();
      return;
    }
    const utt = new SpeechSynthesisUtterance(text);
    utterance = utt;
    utt.onend = () => { if (utterance === utt) { speaking = false; utterance = null; } };
    utt.onerror = () => { if (utterance === utt) { speaking = false; utterance = null; } };
    synth.speak(utt);
    speaking = true;
  }

  function download() {
    if (!resultBlob) return;
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(resultBlob);
      urls.add(a.href);
      a.download = buildDownloadName(files[0]?.name, tool.id, resultExtension);
      a.click();
    } catch {
      copyNotice = 'Download unavailable. Try again.';
    }
  }
  onDestroy(() => { disposed = true; invalidate(); });
</script>

<div class="runner">
  {#if requiresFile}
    <DropZone
      accept={tool.input.accept}
      sizeLimit={tool.input.sizeLimit}
      multiple={false}
      bind:files
      bind:error={dropError}
      on:files={onFiles}
    />
  {/if}

  <form on:submit|preventDefault on:input={invalidate} on:change={invalidate}>
    <ParamsForm defaults={tool.defaults} paramSchema={tool.paramSchema} bind:params on:change={parametersChanged} />
  </form>

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? `Run ${tool.name} again` : `Run ${tool.name}`}
    </button>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
    <button class="btn-secondary" on:click={reset} type="button">Cancel</button>
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

  {#if state === 'done' && resultBlob}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
          <div class="result-actions">
            {#if !previewLimited}<button class="btn-secondary" on:click={copyResult} type="button">
              {copied ? 'Copied' : 'Copy'}
            </button>{/if}
            {#if speakSupported && !isHtml && !previewLimited && resultText}
              <button class="btn-secondary" on:click={() => speak(resultText)} type="button" aria-label={speaking ? 'Stop speaking' : 'Speak this text aloud'}>
                {speaking ? 'Stop' : 'Speak'}
              </button>
            {/if}
            <button class="btn-secondary" on:click={download} type="button">Download</button>
          </div>
        </div>
        <div class="panel-divider"></div>

        {#if copyNotice}<p role="status">{copyNotice}</p>{/if}
        {#if previewLimited}
          <p role="status">{decodedDownloadOnly ? 'Decoded output is binary or exceeds the 256 KiB text preview limit.' : 'Inline preview and copy are limited to 256 KiB of encoded image text.'} The complete {resultBlob.size.toLocaleString()} byte result is available through Download.</p>
        {:else if isHtml}
          <div class="html-viewer" role="region" aria-label="HTML result">
            {@html safeHtml}
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

        {#if showChain && resultBlob}
          <ChainSection
            resultBlob={resultBlob}
            sourceToolId={tool.id}
            resultName={buildDownloadName(files[0]?.name, tool.id, resultExtension)}
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
