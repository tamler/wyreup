<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolModule, ToolProgress } from '@wyreup/core';
  import UtilityForm from './UtilityForm.svelte';
  import DropZone from './DropZone.svelte';
  import type { PreloadAdmission, SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  let files = preloadedFile ? [preloadedFile] : [];
  let params = { ...tool.defaults };
  let valid = false;
  let running = false;
  let error = '';
  let generation = 0;
  let controller: AbortController | null = null;
  let progress: ToolProgress = { stage: 'processing' };
  let result: Blob | null = null;
  let resultUrl = '';
  let width = 0;
  let height = 0;
  let destroyed = false;
  let observedPreload: File | null = null;
  let operationFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function report(file: File | null, status: 'admitted' | 'refused') {
    if (!destroyed && file && file === preloadedFile && files[0] === file)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'PSD conversion did not complete.' });
  }
  function stagePreload(file: File | null) {
    observedPreload = file;
    invalidate(); files = [];
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); files = [file]; }
  }

  function cancel() { if (running) report(operationFile, 'refused'); generation++; controller?.abort(); controller = null; running = false; operationFile = null; }
  function invalidate() {
    cancel(); error = ''; result = null; width = 0; height = 0;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
  }
  function filesChanged(event: CustomEvent<File[]>) { invalidate(); files = event.detail; }
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    if (params !== event.detail.params || !event.detail.valid) invalidate();
    params = event.detail.params; valid = event.detail.valid;
  }

  async function convert() {
    if (!valid || files.length !== 1 || running) return;
    invalidate();
    const ownGeneration = generation, ownController = new AbortController();
    const ownFile = files[0]!, ownTool = tool;
    operationFile = ownFile;
    controller = ownController; running = true;
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      if (!module) throw new Error('PSD converter unavailable.');
      const output = await module.run([ownFile], params, {
        signal: ownController.signal, executionId: crypto.randomUUID(), cache: new Map(),
        onProgress: value => { if (ownGeneration === generation) progress = value; },
      });
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'image/png' || blobs[0]!.size > 96 * 1024 * 1024)
        throw new Error('Expected one bounded PNG output.');
      const bytes = new Uint8Array(await blobs[0]!.slice(0, 33).arrayBuffer());
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
        throw new Error('Output is not a complete PNG header.');
      const header = new DataView(bytes.buffer);
      width = header.getUint32(16); height = header.getUint32(20);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000)
        throw new Error('PNG dimensions exceed the composite limits.');
      result = blobs[0]!; resultUrl = URL.createObjectURL(result);
      report(ownFile, 'admitted');
    } catch (cause) {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { error = cause instanceof Error ? cause.message : 'PSD conversion failed.'; report(ownFile, 'refused'); }
    } finally {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { running = false; controller = null; operationFile = null; }
    }
  }
  onDestroy(() => { destroyed = true; invalidate(); });
</script>

<div class="psd-runner">
  <p>Exports the saved composite at its full resolution. Save a composite in your editor first; this tool does not recomposite layers, effects or unsaved changes.</p>
  <p>Supports version 1 PSD, 8-bit RGB or grayscale, raw or RLE compression, up to 64 MiB and 16 million pixels. PSB, ZIP compression and other color modes are rejected.</p>
  <DropZone accept={tool.input.accept} sizeLimit={tool.input.sizeLimit} bind:files on:files={filesChanged} />
  <UtilityForm defaults={tool.defaults} {params} paramSchema={(tool.paramSchema ?? {}) as UtilitySchema} on:change={changed} />
  <p>Automatic transparency uses the saved merged-transparency flag. An unmarked extra channel remains an auxiliary mask. The explicit extra-channel option changes that interpretation.</p>
  <div class="actions">
    <button type="button" disabled={!valid || files.length !== 1 || running} on:click={convert}>Convert PSD to PNG</button>
    {#if running}<button type="button" on:click={cancel}>Cancel conversion</button>{/if}
  </div>
  {#if running}<p role="status">{progress.message ?? 'Converting saved composite…'}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if result && resultUrl}
    <p role="status">PNG: {width} × {height} pixels, {result.size} bytes.</p>
    <img src={resultUrl} alt="Converted saved PSD composite" />
    <a href={resultUrl} download="composite.png">Download PNG</a>
  {/if}
</div>

<style>
  .psd-runner { display: grid; gap: var(--space-3); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  img { max-width: 100%; max-height: 28rem; object-fit: contain; background: var(--bg-raised); }
  button, a { padding: var(--space-2); font: inherit; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; }
  :is(button, a):focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
