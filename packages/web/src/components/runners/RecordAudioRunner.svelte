<script lang="ts">
  import MicRecorder from './MicRecorder.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';

  // Capture-tool runner. The "run" is the user clicking record on
  // MicRecorder; the captured blob becomes the result. No tool.run()
  // call — capture tools are interactive primitives whose output
  // exists the moment the user stops recording.

  export let tool: SerializedTool;
  // Unused — capture tools start fresh; ignore any chain-passed file.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let preloadedFile: File | null = null;

  type State = 'idle' | 'done';
  let state: State = 'idle';
  let resultFile: File | null = null;
  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;

  function onRecorded(e: CustomEvent<File>) {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultFile = e.detail;
    resultBlob = resultFile;
    resultUrl = URL.createObjectURL(resultBlob);
    markToolUsed(tool.id);
    state = 'done';
  }

  function reset() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    resultBlob = null;
    resultFile = null;
    state = 'idle';
  }

  function download() {
    if (!resultFile) return;
    const a = document.createElement('a');
    a.href = resultUrl ?? URL.createObjectURL(resultFile);
    const ext = (resultFile.type.split('/')[1] ?? 'webm').split(';')[0];
    a.download = buildDownloadName(undefined, tool.id, ext);
    a.click();
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
</script>

<div class="runner">
  {#if state === 'idle'}
    <MicRecorder on:recorded={onRecorded} />
    <p class="runner-hint">
      Audio is captured locally — nothing leaves your device until you choose to chain or download it.
    </p>
  {/if}

  {#if state === 'done' && resultBlob && resultUrl}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Recording</span>
          <div class="result-actions">
            <button class="btn-secondary" on:click={download} type="button">Download</button>
            <button class="btn-secondary" on:click={reset} type="button">Record again</button>
          </div>
        </div>
        <div class="panel-divider"></div>

        <audio class="audio-player" controls src={resultUrl}></audio>
        <p class="result-meta">
          {fmtBytes(resultBlob.size)} · {resultBlob.type || 'audio/webm'}
        </p>

        <ChainSection
          resultBlob={resultBlob}
          sourceToolId={tool.id}
          resultName={buildDownloadName(undefined, tool.id, (resultBlob.type.split('/')[1] ?? 'webm').split(';')[0])}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }

  .runner-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin: 0;
  }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; overflow: visible; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .panel-label { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-subtle); }
  .panel-divider { height: 1px; background: var(--border-subtle); }
  .result-actions { display: flex; gap: var(--space-2); }

  .audio-player {
    width: 100%;
  }

  .result-meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin: 0;
  }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent); border-left: 1px solid var(--accent); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-left: 1px solid var(--accent); }
</style>
