<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolModule, ToolProgress } from '@wyreup/core';
  import UtilityForm from './UtilityForm.svelte';
  import { initialUtilityParams, type UtilitySchema } from './utilityFormState';
  import { opaquePickerValue, pickerGradientParams, prepareGradientResult, type GradientView } from './gradientPreview';
  import type { SerializedTool } from './types';
  export let tool: SerializedTool;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  let params = initialUtilityParams(tool.defaults);
  let valid = false;
  let formGeneration = 0;
  let view: GradientView | null = null;
  let resultBlob: Blob | null = null;
  let firstPicker = opaquePickerValue(tool.defaults.color1);
  let secondPicker = opaquePickerValue(tool.defaults.color2);
  let running = false;
  let error = '';
  let notice = '';
  let generation = 0;
  let controller: AbortController | null = null;
  let progress: ToolProgress = { stage: 'processing' };
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  function clearResult() {
    for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.clear(); view = null; resultBlob = null; notice = '';
  }
  function cancel() { generation++; controller?.abort(); controller = null; running = false; }
  function invalidate() { cancel(); clearResult(); error = ''; }
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    const different = Object.keys(tool.defaults).some((key) => !Object.is(params[key], event.detail.params[key]));
    if (different || !event.detail.valid) invalidate();
    if (different) params = event.detail.params;
    valid = event.detail.valid;
  }
  function pick(field: 'color1' | 'color2', event: Event) {
    invalidate();
    try {
      const value = (event.currentTarget as HTMLInputElement).value;
      params = pickerGradientParams(params, field, value);
      if (field === 'color1') firstPicker = value; else secondPicker = value;
      notice = `${field === 'color1' ? 'First' : 'Second'} picker edit replaces that source with an opaque sRGB color, including its alpha or advanced color format.`;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid picker color.'; }
  }
  async function run() {
    if (!valid) return;
    invalidate(); const own = generation; const active = new AbortController(); controller = active; running = true; progress = { stage: 'processing' };
    try {
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (own !== generation) return;
      if (!module) throw new Error('Gradient generator unavailable.');
      const output = await module.run([], params, { signal: active.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: (value) => { if (own === generation) progress = value; } });
      if (own !== generation) return;
      const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'application/json' || blobs[0]!.size > 32768) throw new Error('Expected one complete JSON gradient result within 32 KiB.');
      const text = await blobs[0]!.text();
      if (own !== generation) return;
      const prepared = prepareGradientResult(text);
      view = prepared; resultBlob = blobs[0]!; firstPicker = prepared.firstPickerHex; secondPicker = prepared.secondPickerHex;
    } catch (cause) { if (own === generation) error = cause instanceof Error ? cause.message : 'Gradient generation failed.'; }
    finally { if (own === generation) { running = false; controller = null; } }
  }
  function clear() { invalidate(); params = initialUtilityParams(tool.defaults); firstPicker = opaquePickerValue(tool.defaults.color1); secondPicker = opaquePickerValue(tool.defaults.color2); valid = false; formGeneration++; }
  function download(json = false) {
    if (!view || !resultBlob) return;
    const blob = json ? resultBlob : new Blob([view.css], { type: 'text/css' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = json ? 'gradient.json' : 'gradient.css'; link.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); downloads.set(url, timer);
  }
  async function copy() {
    if (!view) return;
    const own = generation;
    try { await navigator.clipboard.writeText(view.css); if (own === generation) notice = 'Copied complete CSS value.'; }
    catch { if (own === generation) notice = 'Copy unavailable. Use Download CSS value.'; }
  }
  onDestroy(() => { cancel(); clearResult(); });
</script>

<div class="gradient-runner">
  <p>{tool.description}</p>
  <p>The pickers show opaque sRGB approximations of the last generated colors. Typing preserves your original CSS color and alpha; only an explicit picker edit replaces that source.</p>
  <div class="pickers"><label>First opaque sRGB picker<input type="color" value={firstPicker} on:input={(event) => pick('color1', event)} /></label><label>Second opaque sRGB picker<input type="color" value={secondPicker} on:input={(event) => pick('color2', event)} /></label></div>
  {#key formGeneration}<UtilityForm defaults={tool.defaults} {params} paramSchema={tool.paramSchema as UtilitySchema} on:change={changed} />{/key}
  <div class="actions"><button type="button" disabled={!valid || running} on:click={run}>{running ? 'Generating…' : 'Generate gradient'}</button>{#if running}<button type="button" on:click={() => { invalidate(); notice = 'Generation cancelled.'; }}>Cancel</button>{/if}<button type="button" on:click={clear}>Clear and reset</button></div>
  {#if running}<p role="status">{progress.message ?? 'Generating…'}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if view && resultBlob}
    <section aria-label="Generated gradient">
      <h3>Gradient preview</h3>
      <div class="checkerboard"><div class="gradient" role="img" aria-label="Generated two-color gradient on a checkerboard showing transparency" style:background-image={view.css}></div></div>
      <p>Use this CSS value in a <code>background-image</code> declaration. CSS download contains the exact value; JSON download preserves the complete generator result.</p>
      <pre>{view.css}</pre>
      <div class="actions"><button type="button" on:click={copy}>Copy CSS value</button><button type="button" on:click={() => download()}>Download CSS value</button><button type="button" on:click={() => download(true)}>Download JSON</button></div>
    </section>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .gradient-runner { display: grid; gap: var(--space-3); min-width: 0; }
  .pickers, .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  label { display: grid; gap: var(--space-1); }
  input[type=color] { width: 5rem; height: 2.5rem; padding: 0; border: 1px solid var(--border); cursor: pointer; }
  button { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; } button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  .checkerboard { border: 1px solid var(--border); border-radius: var(--radius-sm); background: repeating-conic-gradient(#d0d0d0 0% 25%, #fff 0% 50%) 0 / 1.5rem 1.5rem; overflow: hidden; }
  .gradient { min-height: 12rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--border); padding: var(--space-3); }
  section { display: grid; gap: var(--space-2); min-width: 0; }
</style>
