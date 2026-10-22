<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ToolModule } from '@wyreup/core';
  import type { PreloadAdmission, SerializedTool } from './types';
  import { TimerState, timerDisplay } from './timerState';
  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  const kind = tool.id === 'stopwatch' ? 'stopwatch' : 'countdown';
  const engine = new TimerState(kind, () => performance.now());
  let durationSeconds = 300; let elapsed = 0; let state = engine.state; let laps = engine.laps;
  let sound = false; let error = ''; let notice = ''; let completion = '';
  let frame = 0; let audio: AudioContext | null = null; let container: HTMLDivElement;
  let controller: AbortController | null = null; let destroyed = false; let generation = 0; let startGeneration = 0;
  const urls = new Set<string>();
  let observedPreload: File | null = null;
  let restoreFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function report(file: File, status: 'admitted' | 'refused') {
    if (!destroyed && file === preloadedFile)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'Timer session was not restored.' });
  }
  function invalidateAsync() {
    if (restoreFile) report(restoreFile, 'refused');
    restoreFile = null; generation++; controller?.abort(); controller = null;
  }
  function stagePreload(file: File | null) {
    observedPreload = file; invalidateAsync(); startGeneration++;
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); void restoreSnapshot(file, true); }
  }
  function refresh(snapshot = engine.snapshot()) { elapsed = snapshot.elapsedMs; state = snapshot.state; laps = snapshot.kind === 'stopwatch' ? snapshot.laps : []; }
  function alertSound() {
    if (!sound || !audio) return;
    try { const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.1; oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.35); }
    catch { notice = 'Audio unavailable; completion remains visible.'; }
  }
  function observeCompletion() { if (engine.takeCompletion()) { completion = 'Countdown complete.'; alertSound(); } }
  function visible() {
    try { refresh(); observeCompletion(); return true; }
    catch (cause) {
      engine.pauseAtLastSample(); refresh();
      error = cause instanceof Error ? cause.message : 'Timer failed.';
      cancelAnimationFrame(frame); frame = 0;
      return false;
    }
  }
  function tick() {
    frame = 0;
    if (visible() && !destroyed) frame = requestAnimationFrame(tick);
  }
  async function start() {
    invalidateAsync();
    error = ''; const own = ++startGeneration;
    if (kind === 'countdown' && sound) {
      try { audio ??= new AudioContext(); await audio.resume(); }
      catch { notice = 'Audio unavailable; completion remains visible.'; }
    }
    if (destroyed || own !== startGeneration) return;
    try { engine.start(); refresh(); if (!frame && !destroyed) frame = requestAnimationFrame(tick); } catch (cause) { error = String(cause); }
  }
  function action(kind: 'pause' | 'reset' | 'lap') {
    invalidateAsync();
    if (kind !== 'lap') startGeneration++;
    try { error = ''; if (kind === 'pause') engine.pause(); else if (kind === 'reset') { engine.reset(); completion = ''; } else engine.lap(); refresh(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Timer action failed.'; }
  }
  function duration() { invalidateAsync(); startGeneration++; try { engine.setDuration(durationSeconds * 1000); completion = ''; error = ''; refresh(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid duration.'; } }
  function save(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); urls.add(url); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); urls.delete(url); }
  async function exportSession(csv = false) {
    invalidateAsync();
    error = ''; controller?.abort(); const own = ++generation; const current = new AbortController(); controller = current;
    try {
      const snapshot = engine.snapshot(); observeCompletion(); refresh(snapshot);
      if (!csv && kind === 'stopwatch') { save(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), 'stopwatch-session.json'); return; }
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);
      if (!module) throw new Error('Tool unavailable.');
      const file = new File([JSON.stringify(snapshot)], 'session.json', { type: 'application/json' });
      const output = await module.run([file], {}, { signal: current.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: () => {} });
      const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.size > 1048576 || blobs[0]!.type !== tool.output.mime) throw new Error('Invalid export result.');
      if (!destroyed && generation === own) save(blobs[0]!, csv ? 'stopwatch-laps.csv' : 'countdown-session.json');
    } catch (cause) { if (!destroyed && generation === own) error = cause instanceof Error ? cause.message : 'Export failed.'; }
  }
  async function restore(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
    await restoreSnapshot(file);
  }
  async function restoreSnapshot(file: File, preload = false) {
    invalidateAsync(); startGeneration++;
    const own = generation, ownTool = tool;
    const current = new AbortController(); controller = current;
    if (preload) restoreFile = file;
    try {
      if (file.size > 102400) throw new Error('Session exceeds 100 KiB.');
      const bytes = await file.slice(0, 102401).arrayBuffer();
      if (destroyed || generation !== own || ownTool !== tool || current.signal.aborted || (preload && preloadedFile !== file)) return;
      if (bytes.byteLength > 102400) throw new Error('Session exceeds 100 KiB.');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      engine.restore(JSON.parse(raw) as unknown); durationSeconds = engine.durationMs / 1000; completion = ''; error = ''; notice = 'Session restored paused; completed timers remain completed without replaying an alert.'; refresh();
      if (preload) report(file, 'admitted');
    } catch (cause) {
      if (!destroyed && generation === own && ownTool === tool) { error = cause instanceof Error ? cause.message : 'Import failed.'; if (preload) report(file, 'refused'); }
    } finally {
      if (!destroyed && generation === own && ownTool === tool) { controller = null; restoreFile = null; }
    }
  }
  async function fullscreen() { invalidateAsync(); try { if (document.fullscreenElement) await document.exitFullscreen(); else await container.requestFullscreen(); } catch { notice = 'Fullscreen is unavailable in this browser.'; } }
  onMount(() => { frame = requestAnimationFrame(tick); document.addEventListener('visibilitychange', visible); });
  onDestroy(() => { destroyed = true; generation++; startGeneration++; controller?.abort(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visible); void audio?.close().catch(() => {}); for (const url of urls) URL.revokeObjectURL(url); });
</script>

<div class="timer" bind:this={container}>
  {#if kind === 'countdown'}
    <label>Duration (seconds) <input type="number" min="1" max="86400" step="any" bind:value={durationSeconds} disabled={state === 'running'} on:input={invalidateAsync} /></label>
    <button type="button" on:click={duration} disabled={state === 'running'}>Replace duration and reset</button>
    <label><input type="checkbox" bind:checked={sound} on:change={invalidateAsync} /> Enable completion sound</label>
  {/if}
  <output aria-label={kind === 'stopwatch' ? 'Elapsed time' : 'Remaining time'}>{timerDisplay(kind === 'stopwatch' ? elapsed : Math.max(0, engine.durationMs - elapsed))}</output>
  <p>State: {state}</p>
  <div class="actions"><button type="button" on:click={start} disabled={state === 'running' || state === 'done'}>{elapsed > 0 ? 'Resume' : 'Start'}</button><button type="button" on:click={() => action('pause')} disabled={state !== 'running'}>Pause</button><button type="button" on:click={() => action('reset')}>Reset</button>{#if kind === 'stopwatch'}<button type="button" on:click={() => action('lap')} disabled={state !== 'running' || laps.length >= 200}>Lap</button>{/if}<button type="button" on:click={fullscreen}>Toggle fullscreen</button></div>
  {#if completion}<p role="status">{completion}</p>{/if}
  {#if kind === 'stopwatch' && elapsed >= 604800000}<p role="status">Seven-day stopwatch limit reached.</p>{/if}
  {#if laps.length}<table><caption>Recorded laps</caption><thead><tr><th>Lap</th><th>Total</th><th>Since previous</th></tr></thead><tbody>{#each laps as lap, index}<tr><td>{index + 1}</td><td>{timerDisplay(lap.totalMs)}</td><td>{timerDisplay(lap.deltaMs)}</td></tr>{/each}</tbody></table>{/if}
  <div class="actions">{#if kind === 'stopwatch'}<button type="button" on:click={() => exportSession(true)}>Export laps CSV</button>{/if}<button type="button" on:click={() => exportSession()}>Save session JSON</button><label>Restore session JSON <input type="file" accept="application/json,.json" on:change={restore} /></label></div>
  <p>Browser timer: alerts are not guaranteed when the device sleeps or the tab is suspended or closed. Imports resume only after you press Start or Resume.</p>
  {#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .timer { display: grid; gap: var(--space-3); background: var(--bg-base); padding: var(--space-3); color: var(--text-primary); }
  output { font-size: clamp(2rem, 7vw, 5rem); font-variant-numeric: tabular-nums; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  button, input { font: inherit; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: inherit; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  button:disabled { opacity: .6; } table { border-collapse: collapse; } th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
</style>
