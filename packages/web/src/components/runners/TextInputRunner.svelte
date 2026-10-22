<script lang="ts">
  import { onDestroy } from 'svelte';
  import ParamsForm from './ParamsForm.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  import DOMPurify from 'dompurify';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { PreloadAdmission, SerializedTool } from './types';
  import type { ToolModule, ToolProgress } from '@wyreup/core';
  import { allowsEmptyText, checkTextUnicode } from './liveTextState';
  import { readImportedText, textAdmissionRequiresRun } from './textImportPolicy';
  import { prepareMarkdownPreview } from './markdownPreview';
  import { markdownCellLines, prepareMarkdownTablePreview, MARKDOWN_TABLE_PAGE_SIZE, type MarkdownTableView } from './markdownTablePreview';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let showChain = true;

  let inputText = '';
  let params: Record<string, unknown> = { ...tool.defaults };

  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let resultBlob: Blob | null = null;
  let resultText = '';
  let resultMime = '';
  let tablePreview: MarkdownTableView | null = null;
  let tablePage = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  let disposed = false;
  let priorInput = inputText;
  let priorParams = params;
  const urls = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  let attemptedPreload: File | null = null;
  let originalFile: File | null = null;
  let inputRevision = 0;
  let originalRevision = 0;
  let useOriginal = false;
  let preloadReading = false;
  $: if (preloadedFile && preloadedFile !== attemptedPreload) {
    attemptedPreload = preloadedFile;
    void importOriginal(preloadedFile);
  }

  async function importOriginal(file: File) {
    reset();
    originalFile = file;
    useOriginal = false;
    preloadReading = true;
    const own = generation;
    const revision = inputRevision;
    try {
      const text = await readImportedText(file, tool.id, params, tool.input.sizeLimit);
      if (disposed || generation !== own || inputRevision !== revision || originalFile !== file) return;
      inputText = text; priorInput = text;
      originalRevision = inputRevision;
      useOriginal = true;
      if (!textAdmissionRequiresRun(tool.id)) onPreloadAdmission?.({ file, status: 'admitted' });
    } catch (cause) {
      if (!disposed && generation === own && originalFile === file) {
        state = 'error'; errorMsg = cause instanceof Error ? cause.message : 'Could not read the input file.';
        onPreloadAdmission?.({ file, status: 'refused', message: errorMsg });
      }
    } finally { if (generation === own) preloadReading = false; }
  }

  function inputEdited() {
    inputRevision++;
    useOriginal = false;
    preloadReading = false;
    reset();
  }

  function downloadOriginal() {
    if (!originalFile) return;
    const url = URL.createObjectURL(originalFile); urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = originalFile.name; link.click();
  }

  function dismissOriginal() {
    originalFile = null; useOriginal = false; preloadReading = false; reset();
  }

  $: if (inputText !== priorInput || params !== priorParams) {
    priorInput = inputText; priorParams = params; reset();
  }
  $: canRun = !preloadReading && (inputText.trim().length > 0 || allowsEmptyText(tool.id, params)) && state !== 'running';
  $: isHtml = resultMime === 'text/html';
  $: isJson =
    resultMime === 'application/json' || resultMime.endsWith('+json');
  // Strip <script>, event handlers, javascript: URLs before {@html}.
  // Input is user-typed text — markdown-to-html and friends are designed
  // to convert it into rendered HTML, but a hostile chain/trigger could
  // pipe attacker-controlled text through these tools to inject script.
  $: safeHtml = isHtml ? tool.id === 'markdown-to-html' ? resultText : DOMPurify.sanitize(resultText) : '';

  async function run() {
    if (!canRun) return;
    reset();
    const own = generation;
    const revision = inputRevision;
    const capturedOriginal = useOriginal && originalRevision === revision ? originalFile : null;
    const capturedParams = params;
    const abort = new AbortController();
    controller = abort;
    state = 'running';
    errorMsg = '';
    resultText = '';
    resultBlob = null;

    try {
      if (!capturedOriginal) checkTextUnicode(tool.id, capturedParams, inputText);
      const preparedTable = tool.id === 'markdown-table-generator' ? prepareMarkdownTablePreview(inputText, params) : null;
      const file = capturedOriginal ?? new File([inputText], 'input.txt', { type: 'text/plain' });
      const toolModule = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (disposed || generation !== own) return;
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);

      const result = await toolModule.run([file], capturedParams, {
        onProgress: (p) => { if (!disposed && generation === own) progress = p; },
        signal: abort.signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      if (disposed || generation !== own) return;

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      const output = await blob.text();
      if (disposed || generation !== own) return;
      const prepared = tool.id === 'markdown-to-html' ? prepareMarkdownPreview(output) : { blob, text: output };
      resultBlob = prepared.blob;
      resultMime = prepared.blob.type;
      resultText = isJsonMime(prepared.blob.type) ? prettifyJson(prepared.text) : prepared.text;
      tablePreview = preparedTable;
      markToolUsed(tool.id);
      state = 'done';
      if (capturedOriginal && originalFile === capturedOriginal && inputRevision === revision && params === capturedParams) {
        onPreloadAdmission?.({ file: capturedOriginal, status: 'admitted' });
      }
    } catch (err) {
      if (!disposed && generation === own) {
        state = 'error'; errorMsg = err instanceof Error ? err.message : String(err);
        if (capturedOriginal && originalFile === capturedOriginal) onPreloadAdmission?.({ file: capturedOriginal, status: 'refused', message: errorMsg });
      }
    } finally { if (generation === own) controller = null; }
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
    generation++;
    preloadReading = false;
    controller?.abort(); controller = null;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    copied = false;
    state = 'idle';
    errorMsg = '';
    resultText = '';
    resultBlob = null;
    tablePreview = null;
    tablePage = 0;
  }

  function clearInput() {
    inputText = '';
    inputEdited();
  }

  function cancel() { useOriginal = false; reset(); }

  let copied = false;

  async function copyResult() {
    const own = generation;
    try {
      await navigator.clipboard.writeText(resultText);
      if (disposed || generation !== own) return;
      copied = true;
      const timer = setTimeout(() => { if (generation === own) copied = false; timers.delete(timer); }, 1500); timers.add(timer);
    } catch { if (!disposed && generation === own) errorMsg = 'Copy unavailable. Use Download.'; }
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
    const url = URL.createObjectURL(resultBlob); urls.add(url); a.href = url;
    const ext = isJson ? 'json' : isHtml ? 'html' : 'txt';
    a.download = buildDownloadName(undefined, tool.id, ext);
    a.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); timers.delete(timer); }, 1000); timers.add(timer);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Cmd/Ctrl+Enter runs the tool.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  }

  $: charCount = inputText.length;
  onDestroy(() => { disposed = true; reset(); if (speaking) window.speechSynthesis.cancel(); });
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
      on:input={inputEdited}
      on:keydown={handleKeydown}
      placeholder={`Type or paste text here. Cmd/Ctrl+Enter to run ${tool.name}.`}
      rows="8"
      aria-label="Input text"
      spellcheck="false"
    ></textarea>
  </div>

  {#if originalFile}
    <p>Original file retained: {originalFile.name}. {useOriginal ? 'Run uses its unchanged bytes.' : 'Edited text runs separately from the original.'}</p>
    <div><button class="btn-secondary" type="button" on:click={downloadOriginal}>Download original</button><button class="btn-secondary" type="button" on:click={() => originalFile && importOriginal(originalFile)}>Retry original</button><button class="btn-secondary" type="button" on:click={dismissOriginal}>Dismiss original</button></div>
  {/if}

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
    <button class="btn-secondary" on:click={cancel} type="button">Cancel</button>
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
        <p>{resultBlob.size.toLocaleString()} output bytes{resultText === '' ? ' — Empty output.' : ''}</p>
        {#if errorMsg}<p role="alert">{errorMsg}</p>{/if}

        {#if tablePreview}
          <section aria-label="Safe Markdown table preview">
            <h3>Table preview</h3>
            <p>{tablePreview.rows.length.toLocaleString()} data rows; page {tablePage + 1} of {Math.max(1, Math.ceil(tablePreview.rows.length / MARKDOWN_TABLE_PAGE_SIZE))}. The Markdown artifact includes every row. Cell HTML is shown as text; cell line breaks use DOM line breaks.</p>
            <div class="table-scroll"><table><caption>Entered table cells</caption><thead><tr>{#each tablePreview.headers as header}<th scope="col">{#each markdownCellLines(header) as line, index}{#if index}<br />{/if}{line}{/each}</th>{/each}</tr></thead><tbody>{#each tablePreview.rows.slice(tablePage * MARKDOWN_TABLE_PAGE_SIZE, (tablePage + 1) * MARKDOWN_TABLE_PAGE_SIZE) as row}<tr>{#each row as cell}<td>{#each markdownCellLines(cell) as line, index}{#if index}<br />{/if}{line}{/each}</td>{/each}</tr>{/each}</tbody></table></div>
            <div class="table-pages"><button type="button" class="btn-secondary" disabled={tablePage === 0} on:click={() => tablePage--}>Previous table page</button><button type="button" class="btn-secondary" disabled={(tablePage + 1) * MARKDOWN_TABLE_PAGE_SIZE >= tablePreview.rows.length} on:click={() => tablePage++}>Next table page</button></div>
          </section>
        {/if}

        {#if isHtml}
          <div class="html-viewer" role="region" aria-label="HTML result">
            {@html safeHtml}
          </div>
        {:else if isJson}
          <FlatJsonResult json={resultText} />
        {:else}
          <pre class="text-viewer" role="region" aria-label="Text result">{resultText}</pre>
        {/if}

        {#if resultBlob && showChain}
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
  .table-scroll { max-width: 100%; overflow-x: auto; }
  table { border-collapse: collapse; min-width: 100%; }
  th, td { border: 1px solid var(--border); padding: var(--space-2); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  caption { text-align: left; font-weight: 600; }
  .table-pages { display: flex; flex-wrap: wrap; gap: var(--space-2); }

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
