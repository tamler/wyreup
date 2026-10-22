<script lang="ts">
  import { onDestroy } from 'svelte';
import { analyzeMp3File, createMp3Decoder, encodePitchMidi, selectPitchNotes, validatePitchParams, type PitchReport } from '@wyreup/core/execution';
  import DropZone from './DropZone.svelte';
  import UtilityForm from './UtilityForm.svelte';
  import type { PreloadAdmission, SerializedTool } from './types';
  import type { UtilitySchema } from './utilityFormState';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  const decoder = createMp3Decoder();
  const numericKeys = ['tempo', 'minHz', 'maxHz', 'noiseGate', 'confidence', 'minDuration', 'mergeGap'] as const;
  const defaults: Record<string, unknown> = {};
  const schema: UtilitySchema = {};
  for (const key of numericKeys) {
    const field = tool.paramSchema?.[key];
    if (!field || field.type !== 'number' || typeof tool.defaults[key] !== 'number')
      throw new Error('MIDI analysis settings unavailable.');
    defaults[key] = tool.defaults[key];
    schema[key] = field;
  }
  let params = { ...defaults };
  let valid = false;
  let files = preloadedFile ? [preloadedFile] : [];
  let running = false;
  let error = '';
  let report: PitchReport | null = null;
  let selected: string[] = [];
  let page = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  let destroyed = false;
  let observedPreload: File | null = null;
  let operationFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function notify(file: File | null, status: 'admitted' | 'refused') {
    if (!destroyed && file && file === preloadedFile && files[0] === file)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'MP3 analysis did not complete.' });
  }
  function stagePreload(file: File | null) {
    observedPreload = file; invalidate(); files = [];
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); files = [file]; }
  }
  $: visible = report?.notes.slice(page * 25, (page + 1) * 25) ?? [];
  $: pages = Math.max(1, Math.ceil((report?.notes.length ?? 0) / 25));

  function releaseDownloads() {
    for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.clear();
  }
  function invalidate() {
    if (running) notify(operationFile, 'refused');
    generation++;
    controller?.abort(); controller = null; running = false;
    report = null; selected = []; page = 0; error = '';
    releaseDownloads();
    operationFile = null;
  }
  function filesChanged(event: CustomEvent<File[]>) { invalidate(); files = event.detail; }
  function changed(event: CustomEvent<{ params: Record<string, unknown>; valid: boolean }>) {
    if (params !== event.detail.params || !event.detail.valid) invalidate();
    params = event.detail.params; valid = event.detail.valid;
  }
  async function analyze() {
    if (!valid || files.length !== 1 || running) return;
    invalidate();
    const ownGeneration = generation;
    const ownController = new AbortController();
    const ownFile = files[0]!, ownTool = tool;
    operationFile = ownFile;
    controller = ownController; running = true;
    try {
      const checked = validatePitchParams({ ...params, acceptedNoteIds: null });
      const result = await analyzeMp3File(ownFile, checked, ownController.signal, decoder);
      if (destroyed || ownGeneration !== generation || ownTool !== tool || ownController.signal.aborted) return;
      if (new Blob([JSON.stringify(result)]).size > 1024 * 1024) throw new Error('Pitch report exceeds 1 MiB.');
      report = result; selected = result.notes.map(note => note.id);
      notify(ownFile, 'admitted');
    } catch (cause) {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { error = cause instanceof Error ? cause.message : 'MP3 analysis failed.'; notify(ownFile, 'refused'); }
    } finally {
      if (!destroyed && ownGeneration === generation && ownTool === tool) { running = false; controller = null; operationFile = null; }
    }
  }
  function choose(id: string, accepted: boolean) {
    releaseDownloads();
    selected = accepted ? [...selected, id] : selected.filter(value => value !== id);
  }
  function download(blob: Blob, name: string) {
    if (blob.size > 1024 * 1024) throw new Error('Output exceeds 1 MiB.');
    const url = URL.createObjectURL(blob);
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
    downloads.set(url, timer);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  }
  function exportMidi() {
    if (!report || running || !valid) return;
    try {
      const checked = validatePitchParams({ ...params, acceptedNoteIds: selected });
      const bytes = encodePitchMidi(selectPitchNotes(report.notes, checked.acceptedNoteIds), checked.tempo as number);
      download(new Blob([new Uint8Array(bytes)], { type: 'audio/midi' }), 'melody.mid');
    } catch (cause) { error = cause instanceof Error ? cause.message : 'MIDI export failed.'; }
  }
  function exportReport() {
    if (!report) return;
    try { download(new Blob([JSON.stringify(report)], { type: 'application/json' }), 'pitch-report.json'); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Report export failed.'; }
  }
  onDestroy(() => { destroyed = true; invalidate(); });
</script>

<div class="midi-runner">
  <p>Experimental monophonic melody transcription. Polyphonic music, drums and voice reconstruction are unsupported. Review detected notes before exporting.</p>
  <p>One MP3 up to 10 MiB and 120 seconds; MPEG-1 Layer III at 44.1 or 48 kHz. Decoding and pitch analysis run locally. Cancel ignores late decoding results; this runner’s native decode must finish before it can decode again.</p>
  <DropZone accept={tool.input.accept} sizeLimit={tool.input.sizeLimit} bind:files on:files={filesChanged} />
  <UtilityForm {defaults} {params} paramSchema={schema} on:change={changed} />
  <div class="actions">
    <button type="button" disabled={!valid || files.length !== 1 || running} on:click={analyze}>Analyze melody</button>
    {#if running}<button type="button" on:click={invalidate}>Cancel analysis</button>{/if}
    {#if files.length}<button type="button" on:click={() => { invalidate(); files = []; }}>Clear file</button>{/if}
  </div>
  {#if running}<p role="status">Decoding MP3 and analyzing pitch…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if report}
    <section aria-label="Detected melody">
      <p role="status">{report.notes.length} detected notes; {selected.length} accepted. Duration {report.duration.toFixed(3)} seconds; {report.voicedFrames} voiced and {report.unvoicedFrames} unvoiced frames.</p>
      {#if report.status === 'no-notes'}<p>No notes met the thresholds. Export creates a valid MIDI file with no note events.</p>{/if}
      <div class="actions">
        <button type="button" on:click={() => { releaseDownloads(); selected = report!.notes.map(note => note.id); }}>Accept all notes</button>
        <button type="button" on:click={() => { releaseDownloads(); selected = []; }}>Reject all notes</button>
      </div>
      <div class="table-scroll"><table>
        <caption>Detected notes, page {page + 1} of {pages}</caption>
        <thead><tr><th>Accept</th><th>ID</th><th>MIDI note</th><th>Frequency (Hz)</th><th>Start (s)</th><th>End (s)</th><th>Confidence</th></tr></thead>
        <tbody>{#each visible as note (note.id)}<tr>
          <td><input type="checkbox" aria-label={`Accept note ${note.id}`} checked={selected.includes(note.id)} on:change={event => choose(note.id, (event.currentTarget as HTMLInputElement).checked)} /></td>
          <td>{note.id}</td><td>{note.note}</td><td>{note.frequency.toFixed(2)}</td><td>{note.start.toFixed(3)}</td><td>{note.end.toFixed(3)}</td><td>{note.confidence.toFixed(3)}</td>
        </tr>{/each}</tbody>
      </table></div>
      <div class="actions">
        <button type="button" disabled={page === 0} on:click={() => page--}>Previous notes</button>
        <button type="button" disabled={page + 1 >= pages} on:click={() => page++}>Next notes</button>
        <button type="button" on:click={exportMidi}>Download MIDI</button>
        <button type="button" on:click={exportReport}>Download pitch report</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .midi-runner { display: grid; gap: var(--space-3); min-width: 0; }
  section { min-width: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .table-scroll { max-width: 100%; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
  button { padding: var(--space-2); font: inherit; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  :is(button, input):focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
</style>
