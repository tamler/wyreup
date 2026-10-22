<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolModule, ToolProgress } from '@wyreup/core';
  import UtilityForm from './UtilityForm.svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  import { initialUtilityParams, type UtilitySchema } from './utilityFormState';
  import type { PreloadAdmission, SerializedTool } from './types';
  import { readImportedText } from './textImportPolicy';

  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  let params = initialUtilityParams(tool.defaults);
  let valid = false;
  let running = false;
  let error = '';
  let resultJson = '';
  let resultBlob: Blob | null = null;
  let notice = '';
  let progress: ToolProgress = { stage: 'processing' };
  let controller: AbortController | null = null;
  let generation = 0;
  const urls = new Set<string>();
  let attemptedPreload: File | null = null;
  let originalFile: File | null = null;
  let imported: { file: File; description: string } | null = null;
  let importing = false;
  $: if (tool.id === 'cron-from-text' && preloadedFile && preloadedFile !== attemptedPreload) {
    attemptedPreload = preloadedFile;
    originalFile = preloadedFile;
    imported = null;
    cancel(); clearResult();
  }

  async function useOriginal() {
    if (!originalFile || tool.id !== 'cron-from-text') return;
    if (params.mode !== 'text') { notice = 'Choose text mode to use this file. Fields mode does not import files.'; return; }
    cancel(); clearResult(); imported = null; error = ''; importing = true;
    const file = originalFile;
    const own = generation;
    try {
      const description = await readImportedText(file, tool.id, params, tool.input.sizeLimit);
      if (generation !== own || originalFile !== file || params.mode !== 'text') return;
      params = { ...params, description };
      imported = { file, description };
    } catch (cause) {
      if (generation === own && originalFile === file) {
        error = cause instanceof Error ? cause.message : 'Could not read the input file.';
        onPreloadAdmission?.({ file, status: 'refused', message: error });
      }
    } finally { if (generation === own) importing = false; }
  }

  function downloadOriginal() {
    if (!originalFile) return;
    const url = URL.createObjectURL(originalFile); urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = originalFile.name; link.click();
  }

  function dismissOriginal() { originalFile = null; imported = null; cancel(); clearResult(); }
  function cancelRequested() { imported = null; cancel(); }

  function clearResult() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    resultJson = '';
    resultBlob = null;
    notice = '';
  }

  function cancel() {
    generation++;
    controller?.abort();
    controller = null;
    running = false;
    importing = false;
  }

  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    if (imported && (event.detail.params.mode !== 'text' || event.detail.params.description !== imported.description)) imported = null;
    if (params !== event.detail.params || !event.detail.valid) {
      cancel();
      clearResult();
      error = '';
    }
    if (params !== event.detail.params) params = event.detail.params;
    if (valid !== event.detail.valid) valid = event.detail.valid;
  }

  async function run() {
    if (!valid || importing) return;
    cancel();
    clearResult();
    error = '';
    const ownGeneration = generation;
    const runParams = params;
    const captured = imported && originalFile === imported.file && runParams.mode === 'text' && runParams.description === imported.description ? imported : null;
    const ownController = new AbortController();
    controller = ownController;
    running = true;
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (generation !== ownGeneration) return;
      if (!module) throw new Error('Tool unavailable.');
      const output = await module.run([], runParams, {
        signal: ownController.signal, executionId: crypto.randomUUID(), cache: new Map(),
        onProgress: (value) => { if (generation === ownGeneration) progress = value; },
      });
      if (generation !== ownGeneration) return;
      const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'application/json') throw new Error('Expected one JSON result.');
      const text = await blobs[0]!.text();
      if (generation !== ownGeneration) return;
      JSON.parse(text);
      resultJson = text;
      resultBlob = blobs[0]!;
      if (captured && imported === captured && originalFile === captured.file && params === runParams) onPreloadAdmission?.({ file: captured.file, status: 'admitted' });
    } catch (cause) {
      if (generation === ownGeneration) {
        error = cause instanceof Error ? cause.message : 'Calculation failed.';
        if (captured && originalFile === captured.file) onPreloadAdmission?.({ file: captured.file, status: 'refused', message: error });
      }
    } finally {
      if (generation === ownGeneration) { running = false; controller = null; }
    }
  }

  function download() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    urls.add(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tool.id}.json`;
    link.click();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(resultJson); notice = 'Copied JSON.'; }
    catch { notice = 'Copy unavailable. Use Download JSON.'; }
  }

  onDestroy(() => { cancel(); clearResult(); });
</script>

<div class="utility-runner">
  {#if tool.networkAccess === 'domain-registration'}<p role="note">This public registration lookup sends only the entered domain to this site's lookup service and its registration provider. File contents are not sent. It requires a network connection; failure does not prove a domain is invalid.</p>{/if}
  {#if tool.id === 'cron-from-text' && originalFile}
    <p>Original file retained: {originalFile.name}. {params.mode === 'fields' ? 'Fields mode does not use this file.' : 'Use the original text explicitly, then Calculate. Editing the description keeps the original for recovery.'}</p>
    <div class="actions"><button type="button" disabled={importing} on:click={useOriginal}>Use original text</button><button type="button" on:click={downloadOriginal}>Download original</button><button type="button" on:click={dismissOriginal}>Dismiss original</button></div>
  {/if}
  <UtilityForm defaults={tool.defaults} {params} paramSchema={tool.paramSchema as UtilitySchema} on:change={changed} />
  <div class="actions">
    <button type="button" disabled={!valid || running || importing} on:click={run}>{running ? 'Calculating…' : 'Calculate'}</button>
    {#if running || importing}<button type="button" on:click={cancelRequested}>Cancel</button>{/if}
  </div>
  {#if running}<p role="status">{progress.message ?? 'Calculating…'}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if resultBlob}
    <FlatJsonResult json={resultJson} />
    <div class="actions"><button type="button" on:click={copy}>Copy JSON</button><button type="button" on:click={download}>Download JSON</button></div>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .utility-runner { display: grid; gap: var(--space-3); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  button { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
