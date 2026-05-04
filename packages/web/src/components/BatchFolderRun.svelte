<script lang="ts">
  import ProgressBar from './runners/ProgressBar.svelte';
  import type { ToolProgress } from '@wyreup/core';

  // Pick a folder, run the chain on every compatible file, ZIP the
  // outputs and download. Uses webkitdirectory for max browser
  // compatibility (Chrome/Edge/Firefox/Safari) — no FSA handle
  // persistence in v1, no cross-session "scan again" flow.
  //
  // Concurrency = 1 (serial). N concurrent inferences each hold their
  // own working tensors; serial keeps the working set bounded for
  // chains that include heavy AI tools. An LRU thrash on the pipeline
  // cache (MAX_PIPELINES=2) is also avoided this way.
  //
  // Output recursion is impossible because outputs are zipped, never
  // written back into the picked folder.

  interface ResolvedStep {
    toolId: string;
    name: string;
    params: Record<string, unknown>;
    valid: boolean;
  }

  export let resolvedSteps: ResolvedStep[] = [];

  type State = 'idle' | 'picking' | 'review' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let pickedFiles: File[] = [];
  let matchingFiles: File[] = [];
  let firstStepAccept: string[] = [];
  let processedCount = 0;
  let failedCount = 0;
  let failedNames: string[] = [];
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let zipUrl: string | null = null;
  let outputCount = 0;

  $: canRun = resolvedSteps.length > 0 && resolvedSteps.every((s) => s.valid);

  function mimeMatches(fileMime: string, acceptList: string[]): boolean {
    if (acceptList.length === 0 || acceptList.includes('*/*')) return true;
    for (const a of acceptList) {
      if (a === fileMime) return true;
      if (a.endsWith('/*')) {
        const prefix = a.slice(0, -2);
        if (fileMime.startsWith(prefix + '/')) return true;
      }
    }
    return false;
  }

  async function pickFolder() {
    if (!canRun) return;
    state = 'picking';
    errorMsg = '';

    const input = document.createElement('input');
    input.type = 'file';
    // webkitdirectory enables folder selection. Standard across modern
    // browsers despite the prefix.
    (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    input.multiple = true;

    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        state = 'idle';
        return;
      }
      pickedFiles = files;

      // Resolve the first step's accept list once. Lazy-imports the
      // registry rather than threading it through props.
      try {
        const { createDefaultRegistry } = await import('@wyreup/core');
        const registry = createDefaultRegistry();
        const firstTool = registry.toolsById.get(resolvedSteps[0]!.toolId);
        firstStepAccept = firstTool?.input.accept ?? ['*/*'];
      } catch {
        firstStepAccept = ['*/*'];
      }

      matchingFiles = files.filter((f) => mimeMatches(f.type || '', firstStepAccept));
      state = 'review';
    };

    input.click();
  }

  async function run() {
    if (matchingFiles.length === 0) return;
    state = 'running';
    processedCount = 0;
    failedCount = 0;
    failedNames = [];
    errorMsg = '';
    if (zipUrl) { URL.revokeObjectURL(zipUrl); zipUrl = null; }

    try {
      const { runChain, createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const chain = resolvedSteps.map((s) => ({ toolId: s.toolId, params: s.params }));

      for (const file of matchingFiles) {
        progress = {
          stage: 'processing',
          percent: Math.round((processedCount / matchingFiles.length) * 100),
          message: `(${processedCount + 1}/${matchingFiles.length}) ${file.name}`,
        };

        try {
          const result = await runChain(
            chain,
            [file],
            {
              onProgress: () => { /* per-file progress is too noisy at this layer */ },
              signal: new AbortController().signal,
              cache: new Map(),
              executionId: crypto.randomUUID(),
            },
            registry,
          );

          const blobs = Array.isArray(result) ? result : [result];
          const blob = blobs[0];
          if (!blob) throw new Error('No output');

          const ext = blob.type.split('/')[1] ?? 'bin';
          const baseName = file.name.replace(/\.[^.]+$/, '');
          // Always namespace into a Wyreup-output/ subfolder inside the
          // ZIP so a recipient unzipping into the source folder can't
          // accidentally clobber the originals.
          const outName = `Wyreup-output/${baseName}.${ext}`;
          zip.file(outName, blob);
          processedCount++;
        } catch (err) {
          failedCount++;
          failedNames.push(file.name);
          // Log per-file error path/length only. Never log file bodies.
          console.warn(`Batch: ${file.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      progress = { stage: 'done', percent: 100, message: 'Compressing ZIP' };
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      if (zipUrl) URL.revokeObjectURL(zipUrl);
      zipUrl = URL.createObjectURL(zipBlob);
      outputCount = processedCount;
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function downloadZip() {
    if (!zipUrl) return;
    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = 'wyreup-batch.zip';
    a.click();
  }

  function reset() {
    state = 'idle';
    pickedFiles = [];
    matchingFiles = [];
    firstStepAccept = [];
    processedCount = 0;
    failedCount = 0;
    failedNames = [];
    errorMsg = '';
    if (zipUrl) { URL.revokeObjectURL(zipUrl); zipUrl = null; }
  }
</script>

<details class="batch-section">
  <summary class="batch-summary">
    <span class="batch-summary__icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    </span>
    <span>Or run on every file in a folder</span>
  </summary>

  <div class="batch-body">
    {#if state === 'idle' || state === 'picking'}
      <p class="batch-help">
        Pick a folder; the chain runs on each compatible file. Outputs
        download as a ZIP. Original files are never modified.
      </p>
      <button class="btn-secondary" type="button" on:click={pickFolder} disabled={!canRun || state === 'picking'}>
        {state === 'picking' ? 'Opening picker…' : 'Pick folder…'}
      </button>
    {:else if state === 'review'}
      <div class="review">
        <p class="review__line">
          <strong>{matchingFiles.length}</strong> of {pickedFiles.length} files match this chain
          {#if matchingFiles.length < pickedFiles.length}
            <span class="review__sub">— {pickedFiles.length - matchingFiles.length} skipped (wrong type)</span>
          {/if}
        </p>
        {#if matchingFiles.length > 0}
          <div class="review__actions">
            <button class="btn-primary" type="button" on:click={run}>Run on {matchingFiles.length} file{matchingFiles.length === 1 ? '' : 's'}</button>
            <button class="btn-ghost-sm" type="button" on:click={reset}>Cancel</button>
          </div>
        {:else}
          <button class="btn-ghost-sm" type="button" on:click={reset}>Cancel</button>
        {/if}
      </div>
    {:else if state === 'running'}
      <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
    {:else if state === 'error'}
      <div class="batch-error" role="alert">
        <p class="batch-error__msg">{errorMsg}</p>
        <button class="btn-ghost-sm" type="button" on:click={reset}>Reset</button>
      </div>
    {:else if state === 'done'}
      <div class="batch-result">
        <p class="batch-result__line">
          Processed <strong>{outputCount}</strong> file{outputCount === 1 ? '' : 's'}
          {#if failedCount > 0}
            · <span class="batch-result__failed">{failedCount} failed</span>
          {/if}
        </p>
        {#if failedCount > 0}
          <details class="batch-result__failures">
            <summary>Show failures</summary>
            <ul>
              {#each failedNames as fn}
                <li>{fn}</li>
              {/each}
            </ul>
          </details>
        {/if}
        <div class="batch-result__actions">
          <button class="btn-primary" type="button" on:click={downloadZip}>Download ZIP</button>
          <button class="btn-ghost-sm" type="button" on:click={reset}>Run another batch</button>
        </div>
      </div>
    {/if}
  </div>
</details>

<style>
  .batch-section {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    overflow: hidden;
  }

  .batch-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    user-select: none;
  }

  .batch-summary::-webkit-details-marker { display: none; }
  .batch-summary:hover { color: var(--text-primary); }

  .batch-summary__icon {
    display: inline-flex;
    color: var(--text-subtle);
  }

  .batch-section[open] .batch-summary {
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }

  .batch-body {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .batch-help {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }

  .review { display: flex; flex-direction: column; gap: var(--space-3); }
  .review__line { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-primary); margin: 0; }
  .review__line strong { color: var(--accent-text); font-weight: 600; }
  .review__sub { color: var(--text-subtle); font-size: var(--text-xs); }
  .review__actions { display: flex; gap: var(--space-2); align-items: center; }

  .batch-error {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
  }
  .batch-error__msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--danger);
    margin: 0;
  }

  .batch-result { display: flex; flex-direction: column; gap: var(--space-3); }
  .batch-result__line { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-primary); margin: 0; }
  .batch-result__line strong { color: var(--accent-text); font-weight: 600; }
  .batch-result__failed { color: var(--danger); }
  .batch-result__actions { display: flex; gap: var(--space-2); align-items: center; }
  .batch-result__failures summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }
  .batch-result__failures ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    max-height: 160px;
    overflow: auto;
  }

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
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    align-self: flex-start;
  }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:disabled { color: var(--text-subtle); cursor: not-allowed; }

  .btn-ghost-sm {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
  }
  .btn-ghost-sm:hover { color: var(--text-muted); }
</style>
