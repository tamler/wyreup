<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ToolModule } from '@wyreup/core';
  import UtilityForm from './UtilityForm.svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  import JsonPathResults from './JsonPathResults.svelte';
  import { initialUtilityParams } from './utilityFormState';
  import { createLiveTextSession, LIVE_TEXT_IDS, LIVE_TEXT_BYTES, type LiveTextSnapshot } from './liveTextState';
  import type { PreloadAdmission, SerializedTool } from './types';
  import { prepareMarkdownPreview } from './markdownPreview';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let showChain = true;
  let text = '';
  let params = initialUtilityParams(tool.defaults);
  let valid = false;
  let mounted = false;
  let notice = '';
  let preloadWaiting = !!preloadedFile;
  let preloadError = '';
  let snapshot: LiveTextSnapshot = { status: 'idle', error: '', text: '', blob: null, progress: { stage: 'processing' } };
  let session: ReturnType<typeof createLiveTextSession> | null = null;
  let inputGeneration = 0;
  let resultGeneration = 0;
  let attemptedPreload: File | null = null;
  let originalFile: File | null = null;
  const urls = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const supported = LIVE_TEXT_IDS.some(id => id === tool.id) && tool.cost !== 'credit';
  function clearUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); for (const timer of timers) clearTimeout(timer); timers.clear(); }
  function prepare(blob: Blob, output: string) {
    return tool.id === 'markdown-to-html' ? prepareMarkdownPreview(output) : { blob, text: output };
  }
  function update() { resultGeneration++; clearUrls(); notice = ''; if (preloadWaiting || preloadError) { session?.cancel(); return; } session?.update(text, params, valid); }
  function inputChanged(event?: Event) { if (event) text = (event.currentTarget as HTMLTextAreaElement).value; preloadWaiting = false; preloadError = ''; inputGeneration++; update(); }
  function preloadFailed(message: string) { preloadWaiting = false; preloadError = message; resultGeneration++; clearUrls(); session?.cancel(); }
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    params = event.detail.params; valid = event.detail.valid; update();
  }
  onMount(() => {
    mounted = true;
    if (!supported) return;
    session = createLiveTextSession({ id: tool.id, load: async () => {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (!module) throw new Error('Tool unavailable.'); return module;
    }, publish: value => { snapshot = value; }, prepare });
    update();
  });
  $: if (mounted && supported && preloadedFile && preloadedFile !== attemptedPreload) {
    attemptedPreload = preloadedFile;
    void importOriginal(preloadedFile);
  }
  async function importOriginal(file: File) {
    originalFile = file;
    inputGeneration++; resultGeneration++; clearUrls(); session?.cancel();
    preloadWaiting = true; preloadError = '';
    const own = inputGeneration;
    try {
      if (file.size > LIVE_TEXT_BYTES) throw new Error('Live input exceeds 1 MiB. Use the file tool for larger work.');
      const bytes = await file.slice(0, LIVE_TEXT_BYTES + 1).arrayBuffer();
      if (!mounted || own !== inputGeneration || preloadedFile !== file) return;
      if (bytes.byteLength > LIVE_TEXT_BYTES) throw new Error('Live input exceeds 1 MiB. Use the file tool for larger work.');
      let value: string;
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('Live input must be valid UTF-8.'); }
      text = value; inputChanged();
      onPreloadAdmission?.({ file, status: 'admitted' });
    } catch (cause) {
      if (mounted && own === inputGeneration && preloadedFile === file) {
        const message = cause instanceof Error ? cause.message : 'Could not read the input file.';
        preloadFailed(message);
        onPreloadAdmission?.({ file, status: 'refused', message });
      }
    }
  }
  function downloadOriginal() {
    if (!originalFile) return;
    const url = URL.createObjectURL(originalFile); urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = originalFile.name; link.click();
  }
  function dismissOriginal() { originalFile = null; inputGeneration++; preloadWaiting = false; preloadError = ''; session?.cancel(); clearUrls(); }
  function cancel() { inputGeneration++; resultGeneration++; preloadWaiting = false; session?.cancel(); clearUrls(); notice = 'Cancelled. Edit the input to calculate again.'; }
  function clear() { text = ''; inputChanged(); }
  async function copy() {
    const blob = snapshot.blob;
    const own = resultGeneration;
    try { await navigator.clipboard.writeText(snapshot.text); if (mounted && resultGeneration === own && snapshot.blob === blob) notice = 'Copied.'; }
    catch { if (mounted && resultGeneration === own && snapshot.blob === blob) notice = 'Copy unavailable. Use Download.'; }
  }
  function download() {
    if (!snapshot.blob) return;
    const url = URL.createObjectURL(snapshot.blob); urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = resultName; link.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); timers.delete(timer); }, 1000); timers.add(timer);
  }
  $: resultName = buildDownloadName(undefined, tool.id, tool.id === 'markdown-to-html' ? 'html' : 'json');
  onDestroy(() => { mounted = false; inputGeneration++; resultGeneration++; session?.dispose(); clearUrls(); });
</script>

<div class="live-text-runner">
  <label for="live-text-input">Input text</label>
  <textarea id="live-text-input" rows="8" bind:value={text} on:input={inputChanged} spellcheck="false"></textarea>
  <p class="help">Local automatic calculation after 300 ms. Input and output are limited to 1 MiB each.</p>
  {#if originalFile}<p>Original file: {originalFile.name}.</p><div class="actions"><button type="button" on:click={downloadOriginal}>Download original</button><button type="button" on:click={() => originalFile && importOriginal(originalFile)}>Retry original</button><button type="button" on:click={dismissOriginal}>Dismiss original</button></div>{/if}
  <UtilityForm defaults={tool.defaults} {params} paramSchema={tool.paramSchema ?? {}} on:change={changed} />
  <div class="actions"><button type="button" on:click={clear}>Clear input</button>{#if snapshot.status === 'waiting' || snapshot.status === 'running'}<button type="button" on:click={cancel}>Cancel calculation</button>{/if}</div>
  {#if !supported}<p role="alert">This tool does not support automatic local runs.</p>{/if}
  {#if snapshot.status === 'waiting'}<p role="status">Waiting for input…</p>{/if}
  {#if snapshot.status === 'running'}<p role="status">{snapshot.progress.message ?? 'Calculating locally…'}</p>{/if}
  {#if snapshot.error}<p role="alert">{snapshot.error}</p>{/if}
  {#if preloadError}<p role="alert">{preloadError}</p>{/if}
  {#if snapshot.status === 'done' && snapshot.blob}
    <section class="result" aria-label="Live result">
      <p>{snapshot.blob.size.toLocaleString()} output bytes{snapshot.text === '' ? ' — Empty output.' : ''}</p>
      {#if tool.id === 'markdown-to-html'}<div class="html-viewer" role="region" aria-label="Safe HTML preview">{@html snapshot.text}</div>
      {:else if tool.id === 'json-path'}<JsonPathResults json={snapshot.text} />
      {:else}<FlatJsonResult json={snapshot.text} />{/if}
      <div class="actions"><button type="button" on:click={copy}>Copy result</button><button type="button" on:click={download}>Download result</button></div>
      {#if showChain}
        <ChainSection resultBlob={snapshot.blob} {resultName} sourceToolId={tool.id} />
      {/if}
    </section>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .live-text-runner { display: flex; flex-direction: column; gap: var(--space-3); } textarea { box-sizing: border-box; width: 100%; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); background: var(--bg); font-family: var(--font-mono); resize: vertical; } .help { font-size: var(--text-sm); color: var(--text-muted); margin: 0; } .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); } button { min-height: 32px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-raised); color: var(--text-primary); } button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; } .result { border: 1px solid var(--border); padding: var(--space-3); border-radius: var(--radius-md); } .html-viewer { overflow-wrap: anywhere; }
</style>
