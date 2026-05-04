<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ChainSection from './ChainSection.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // qr-reader: split panel — original image on the left, decoded
  // text on the right. When detected:false, surface a clear "no QR
  // found" message rather than an empty result.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface Result {
    detected: boolean;
    data?: string;
    location?: unknown;
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: Result | null = null;
  let resultBlob: Blob | null = null;
  let imageUrl: string | null = null;
  let copied = false;

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= 1 && state !== 'running';
  $: {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = files[0] ? URL.createObjectURL(files[0]) : null;
  }
  $: kind = result?.data ? detectKind(result.data) : null;

  function detectKind(text: string): { label: string; href: string | null } {
    const t = text.trim();
    if (/^https?:\/\//i.test(t)) return { label: 'URL', href: t };
    if (/^mailto:/i.test(t)) return { label: 'Email', href: t };
    if (/^tel:/i.test(t)) return { label: 'Phone', href: t };
    if (/^WIFI:/i.test(t)) return { label: 'Wi-Fi', href: null };
    if (/^BEGIN:VCARD/i.test(t)) return { label: 'vCard', href: null };
    return { label: 'Text', href: null };
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    result = null;
    resultBlob = null;
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error('Tool not found.');
      const blobs = await toolModule.run(files, {}, {
        onProgress: (p) => { progress = p; },
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: crypto.randomUUID(),
      });
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) throw new Error('No output.');
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as Result;
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  async function copyData() {
    if (!result?.data) return;
    try {
      await navigator.clipboard.writeText(result.data);
      copied = true;
      setTimeout(() => { copied = false; }, 1200);
    } catch { /* ignore */ }
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(files[0]?.name, tool.id, 'json');
    a.click();
  }
</script>

<div class="runner">
  <DropZone accept={tool.input.accept} multiple={false} bind:files bind:error={dropError} on:files={onFiles} />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? 'Decode again' : 'Decode QR'}
    </button>
  {/if}

  {#if state === 'running'}<ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />{/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert"><p class="error-msg">{errorMsg}</p></div>
  {/if}

  {#if state === 'done' && result}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="split">
          {#if imageUrl}
            <img src={imageUrl} alt="Source QR" class="qr-image" />
          {/if}
          <div class="decoded">
            {#if !result.detected}
              <div class="not-found">
                <span class="not-found__title">No QR code found</span>
                <span class="not-found__sub">Try a clearer image or one with better contrast.</span>
              </div>
            {:else if result.data}
              {@const k = kind}
              <div class="decoded__head">
                <span class="badge">{k?.label ?? 'Text'}</span>
                <button class="btn-secondary" on:click={copyData} type="button">{copied ? 'Copied' : 'Copy'}</button>
                {#if k?.href}
                  <a class="btn-secondary" href={k.href} target="_blank" rel="noopener noreferrer">Open</a>
                {/if}
              </div>
              <pre class="decoded__text">{result.data}</pre>
            {/if}
          </div>
        </div>

        <div class="result-actions">
          <button class="btn-secondary" on:click={downloadJson} type="button">Download JSON</button>
        </div>

        <details class="json-drawer">
          <summary>Show raw JSON</summary>
          <pre class="json-view">{JSON.stringify(result, null, 2)}</pre>
        </details>

        {#if resultBlob}
          <ChainSection resultBlob={resultBlob} sourceToolId={tool.id} resultName={buildDownloadName(files[0]?.name, tool.id, 'json')} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .runner { display: flex; flex-direction: column; gap: var(--space-4); }
  .btn-primary { height: 32px; padding: 0 var(--space-3); background: var(--accent); color: var(--black); border: none; border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--text-base); font-weight: 500; cursor: pointer; align-self: flex-start; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-secondary { height: 28px; padding: 0 var(--space-3); background: transparent; color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .error-panel { border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--bg-elevated); padding: var(--space-3) var(--space-4); }
  .error-msg { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--danger); margin: 0; }

  .result-panel { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1px; }
  .result-panel__inner { background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: calc(var(--radius-md) - 1px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }

  .split { display: grid; grid-template-columns: 200px 1fr; gap: var(--space-4); align-items: start; }
  @media (max-width: 600px) { .split { grid-template-columns: 1fr; } }

  .qr-image { width: 100%; max-width: 200px; height: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: white; padding: var(--space-1); }

  .decoded { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  .decoded__head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .badge { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-text); border: 1px solid var(--accent-hover); border-radius: var(--radius-sm); padding: 2px 8px; }
  .decoded__text { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: var(--space-3); overflow: auto; white-space: pre-wrap; word-break: break-all; max-height: 240px; margin: 0; }

  .not-found { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); background: var(--bg); border: 1px dashed var(--border); border-radius: var(--radius-sm); }
  .not-found__title { font-family: var(--font-sans); font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
  .not-found__sub { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }

  .result-actions { display: flex; gap: var(--space-2); }

  .json-drawer summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.08em; list-style: none; padding: var(--space-1) 0; }
  .json-drawer summary:hover { color: var(--text-muted); }
  .json-drawer summary::-webkit-details-marker { display: none; }
  .json-view { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-primary); background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: var(--space-3); overflow: auto; max-height: 280px; white-space: pre-wrap; margin: var(--space-2) 0 0; }

  .brackets::before, .brackets::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
</style>
