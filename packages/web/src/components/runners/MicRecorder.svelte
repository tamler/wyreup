<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  // Push-to-talk microphone capture. Sits alongside the dropzone for
  // tools that accept audio. Dispatches a `recorded` event with a File
  // when the user finishes, which the parent runner treats identically
  // to a dropped file.
  //
  // Privacy contract: we only request mic access when the user clicks
  // record. Stream + tracks are torn down on stop / unmount so the
  // browser's recording indicator clears.

  const dispatch = createEventDispatcher<{ recorded: File }>();

  type State = 'idle' | 'requesting' | 'recording' | 'denied' | 'unsupported';
  let state: State = 'idle';
  let elapsedMs = 0;
  let errorMsg = '';

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Pick the best MIME the browser supports. Webm/opus is the most
  // widely supported recordable format; transcribe's Web Audio decoder
  // handles every output here.
  function pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  $: supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  async function start() {
    if (!supported) {
      state = 'unsupported';
      return;
    }
    state = 'requesting';
    errorMsg = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|denied|NotAllowedError/i.test(msg)) {
        state = 'denied';
      } else {
        state = 'idle';
        errorMsg = msg;
      }
      return;
    }
    const mime = pickMime();
    chunks = [];
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (err) {
      stopStream();
      state = 'idle';
      errorMsg = err instanceof Error ? err.message : String(err);
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      // Strip MIME parameters (e.g. ";codecs=opus") so the resulting
      // File's type is the base MIME tools' accept lists check against.
      // Belt-and-suspenders with mimeMatches' new param-stripping; this
      // way native viewers also recognize the file cleanly.
      const rawType = chunks[0]?.type ?? mime ?? 'audio/webm';
      const baseType = (rawType.split(';')[0] ?? 'audio/webm').trim();
      const blob = new Blob(chunks, { type: baseType });
      const ext = baseType.split('/')[1] ?? 'webm';
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: baseType });
      stopStream();
      state = 'idle';
      elapsedMs = 0;
      if (file.size > 0) dispatch('recorded', file);
    };
    recorder.start();
    startTime = Date.now();
    state = 'recording';
    timer = setInterval(() => {
      elapsedMs = Date.now() - startTime;
    }, 100);
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function stopStream() {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    recorder = null;
  }

  function fmtTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onDestroy(() => {
    stop();
    stopStream();
  });
</script>

{#if state === 'unsupported'}
  <p class="mic-unsupported">Microphone capture isn't supported in this browser.</p>
{:else if state === 'denied'}
  <div class="mic-denied" role="alert">
    <strong>Microphone permission was denied.</strong>
    <span>Allow mic access in your browser settings to record.</span>
    <button class="btn-ghost-sm" on:click={() => { state = 'idle'; }} type="button">Try again</button>
  </div>
{:else}
  <div class="mic-row" class:mic-row--recording={state === 'recording'}>
    {#if state === 'idle' || state === 'requesting'}
      <button
        class="mic-btn"
        on:click={start}
        disabled={state === 'requesting'}
        type="button"
        aria-label="Start recording"
      >
        <span class="mic-btn__dot" aria-hidden="true"></span>
        <span class="mic-btn__label">{state === 'requesting' ? 'Allow mic…' : 'Record'}</span>
      </button>
      <span class="mic-hint">…or drop an audio file above</span>
    {:else if state === 'recording'}
      <button
        class="mic-btn mic-btn--stop"
        on:click={stop}
        type="button"
        aria-label="Stop recording"
      >
        <span class="mic-btn__dot mic-btn__dot--rec" aria-hidden="true"></span>
        <span class="mic-btn__label">Stop</span>
      </button>
      <span class="mic-time" aria-live="polite">{fmtTime(elapsedMs)}</span>
      <span class="mic-hint">Recording — click Stop when done.</span>
    {/if}
    {#if errorMsg}
      <span class="mic-error" role="alert">{errorMsg}</span>
    {/if}
  </div>
{/if}

<style>
  .mic-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    flex-wrap: wrap;
  }

  .mic-row--recording {
    border-style: solid;
    border-color: var(--accent);
    background: var(--bg-raised);
  }

  .mic-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .mic-btn:hover:not(:disabled) {
    border-color: var(--text-muted);
  }

  .mic-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .mic-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .mic-btn--stop {
    border-color: var(--accent);
    color: var(--accent);
  }

  .mic-btn__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  .mic-btn__dot--rec {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
    animation: mic-pulse 1.2s ease-in-out infinite;
  }

  @keyframes mic-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }

  @media (prefers-reduced-motion: reduce) {
    .mic-btn__dot--rec { animation: none; }
  }

  .mic-time {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .mic-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .mic-error {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .mic-unsupported {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin: 0;
  }

  .mic-denied {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .mic-denied strong {
    color: var(--danger);
  }

  .mic-denied span {
    color: var(--text-muted);
  }

  .btn-ghost-sm {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: var(--space-1) 0;
    text-decoration: underline;
  }

  .btn-ghost-sm:hover {
    color: var(--text-primary);
  }
</style>
