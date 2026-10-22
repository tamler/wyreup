<script lang="ts">
  import { onDestroy } from 'svelte';
import { runStlFileJob, validateStlParams, STL_LIMITS, type StlJobResult } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import DropZone from './DropZone.svelte';
  import type { PreloadAdmission, SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  let files = preloadedFile ? [preloadedFile] : [];
  let params = { ...tool.defaults };
  let valid = false;
  let running = false;
  let error = '';
  let generation = 0;
  let controller: AbortController | null = null;
  let result: StlJobResult | null = null;
  let resultUrl = '';
  let layerIndex = 0;
  let destroyed = false;
  let observedPreload: File | null = null;
  let operationFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function report(file: File | null, status: 'admitted' | 'refused') {
    if (!destroyed && file && file === preloadedFile && files[0] === file)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'STL parsing did not complete.' });
  }
  function stagePreload(file: File | null) {
    observedPreload = file; invalidate(); files = [];
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); files = [file]; }
  }
  $: layer = result?.report.layers[layerIndex];
  $: extent = result?.report.extentMm;
  $: width = Math.max(extent?.[0] ?? 1, 0.001);
  $: height = Math.max(extent?.[1] ?? 1, 0.001);
  $: padding = Math.max(width, height) * 0.025;
  $: viewBox = `${-padding} ${-padding} ${width + 2 * padding} ${height + 2 * padding}`;

  function cancel() {
    if (running) report(operationFile, 'refused');
    generation++; controller?.abort(); controller = null; running = false;
    operationFile = null;
  }
  function invalidate() {
    cancel(); error = ''; result = null; layerIndex = 0;
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
      const checked = validateStlParams(params), input = ownFile;
      if (!input.size || input.size > STL_LIMITS.inputBytes) throw new Error('Select one nonempty STL of at most 20 MiB.');
      if (ownController.signal.aborted) return;
      const bytes = new Uint8Array(await input.arrayBuffer());
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      const value = await runStlFileJob({ type: 'stl-contours', bytes, params: { ...checked } }, ownController.signal);
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      result = value;
      resultUrl = URL.createObjectURL(new Blob([value.gcode], { type: 'text/plain' }));
      report(ownFile, 'admitted');
    } catch (cause) {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { error = cause instanceof Error ? cause.message : 'STL conversion failed.'; report(ownFile, 'refused'); }
    } finally {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { running = false; controller = null; operationFile = null; }
    }
  }
  onDestroy(() => { destroyed = true; invalidate(); });
</script>

<div class="stl-runner">
  <p>Horizontal contours from a closed manifold STL. This is contour preview G-code only, with no extrusion, heaters or homing. It is not printer-ready.</p>
  <p>Choose the STL coordinate units. The model is translated to a local XYZ origin and checked against the envelope. Open, nonmanifold, duplicate, degenerate or intersecting meshes are rejected; no repair is performed.</p>
  <p>Limits: 20 MiB, 200,000 triangles and 2,000 full-height layers. Complex meshes can also exceed the bounded geometry checks.</p>
  <DropZone accept={tool.input.accept} sizeLimit={tool.input.sizeLimit} bind:files on:files={filesChanged} />
  <UtilityForm defaults={tool.defaults} {params} paramSchema={(tool.paramSchema ?? {}) as UtilitySchema} on:change={changed} />
  <div class="actions">
    <button type="button" disabled={!valid || files.length !== 1 || running} on:click={convert}>Generate contour preview</button>
    {#if running}<button type="button" on:click={cancel}>Cancel conversion</button>{/if}
  </div>
  {#if running}<p role="status">Validating mesh and slicing all layers…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if result && resultUrl && layer}
    <p role="status">{result.report.triangleCount} triangles, {result.report.vertexCount} welded vertices; {result.report.layerCount} full-height layers.</p>
    <p>XYZ translation (mm): {result.report.translationMm.join(', ')}. Extent (mm): {result.report.extentMm.join(', ')}. Partial top excluded: {result.report.partialTopMm.toFixed(6)} mm.</p>
    <label>Preview layer
      <select bind:value={layerIndex}>
        {#each result.report.layers as option}
          <option value={option.index}>{option.index + 1}: Z {option.zMm} mm{option.empty ? ' (empty)' : ''}</option>
        {/each}
      </select>
    </label>
    <p>Z {layer.zMm} mm: {layer.contours.length} contours. Outer area {layer.outerAreaMm2.toFixed(6)} mm²; hole area {layer.holeAreaMm2.toFixed(6)} mm²; net area {layer.netAreaMm2.toFixed(6)} mm²; perimeter {layer.perimeterMm.toFixed(6)} mm.</p>
    <svg {viewBox} role="img" aria-label={`Actual contours for layer ${layerIndex + 1}, Z ${layer.zMm} millimetres`}>
      <g transform={`translate(0 ${height}) scale(1 -1)`}>
        {#each layer.contours as contour}
          <polygon points={contour.points.map(point => point.join(',')).join(' ')} class:hole={contour.hole}>
            <title>{contour.hole ? 'Hole' : 'Outer contour'}, nesting depth {contour.depth}, area {contour.areaMm2} square millimetres</title>
          </polygon>
        {/each}
      </g>
    </svg>
    {#if layer.empty}<p>This layer lies in a vertical gap between disconnected solids.</p>{/if}
    <a href={resultUrl} download="contour-preview.gcode">Download all-layer contour G-code</a>
    <p>The download contains every full-height layer, including empty gap layers. The selector changes only this preview.</p>
  {/if}
</div>

<style>
  .stl-runner { display: grid; gap: var(--space-3); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  svg { width: 100%; max-height: 28rem; background: var(--bg-raised); border: 1px solid var(--border); }
  polygon { fill: none; stroke: var(--accent-text, #385a90); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
  polygon.hole { stroke: var(--text-secondary, #666); stroke-dasharray: 4 3; }
  label { display: grid; gap: var(--space-1); }
  button, a, select { padding: var(--space-2); font: inherit; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; }
  :is(button, a, select):focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
