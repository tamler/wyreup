<script lang="ts">
  import { dropStore } from '../stores/drop';
  import { stashChainFile } from './runners/chainStorage';
  import { createDefaultRegistry, type ToolModule } from '@wyreup/core';

  // Live three-step walkthrough. Replaces the static "01 Drop / 02 Pick /
  // 03 Download" copy with a working flow:
  //
  //   01  drop zone — accepts a file (or shares state with the hero drop)
  //   02  filtered tool list — top compatible tools for the dropped file
  //   03  Run button — navigates to the picked tool with the file
  //       pre-loaded via chainStorage
  //
  // The hero drop on the same page also feeds dropStore, so dropping
  // there lights up steps 02/03 here too. Either entry point works.

  let isDragOver = false;
  let zoneEl: HTMLElement;
  let pickedToolId: string | null = null;
  let registry: ReturnType<typeof createDefaultRegistry> | null = null;
  let registryLoading = false;

  $: file = $dropStore?.file ?? null;
  $: compatibleTools = $dropStore?.compatibleTools ?? [];
  // Reset the picked tool whenever a new file is dropped (otherwise the
  // previous selection sticks even if it's now incompatible).
  $: if (file) {
    if (pickedToolId && !compatibleTools.some((t) => t.id === pickedToolId)) {
      pickedToolId = null;
    }
  } else {
    pickedToolId = null;
  }

  $: pickedTool = pickedToolId
    ? compatibleTools.find((t) => t.id === pickedToolId) ?? null
    : null;

  async function ensureRegistry() {
    if (registry || registryLoading) return;
    registryLoading = true;
    registry = createDefaultRegistry();
    registryLoading = false;
  }

  async function processFile(f: File) {
    await ensureRegistry();
    if (!registry) return;
    const tools = registry.toolsForFiles([f]);
    dropStore.set({
      file: f,
      mime: f.type || 'application/octet-stream',
      compatibleTools: tools,
    });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }
  function handleDragLeave(e: DragEvent) {
    if (!zoneEl.contains(e.relatedTarget as Node)) isDragOver = false;
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void processFile(f);
  }
  function handlePick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void processFile(f);
    };
    input.click();
  }

  function pickTool(id: string) {
    pickedToolId = id;
  }

  async function run() {
    if (!file || !pickedTool) return;
    await stashChainFile(file, { autoAccept: true });
    window.location.href = `/tools/${pickedTool.id}`;
  }

  function fmtName(t: ToolModule): string {
    return t.name;
  }

  $: previewTools = compatibleTools.slice(0, 6);
  $: extraCount = Math.max(0, compatibleTools.length - previewTools.length);
</script>

<div class="how-row">
  <!-- 01 — Drop -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    bind:this={zoneEl}
    class="how-card"
    class:how-card--active={!!file}
    class:how-card--dragover={isDragOver}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
    on:click={() => { if (!file) handlePick(); }}
    on:keydown={(e) => { if (!file && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handlePick(); } }}
    role={file ? undefined : 'button'}
    tabindex={file ? -1 : 0}
    aria-label={file ? 'Step 1 — file dropped' : 'Step 1 — drop a file or click to browse'}
  >
    <div class="how-card__num">01</div>
    <div class="how-card__verb">Drop.</div>
    {#if file}
      <p class="how-card__body">
        <strong class="how-card__filename">{file.name}</strong>
        <span class="how-card__filemeta">{(file.type || 'unknown').split('/').pop()} · {(file.size / 1024).toFixed(1)} KB</span>
      </p>
      <button class="how-card__change" on:click|stopPropagation={handlePick} type="button">
        Try a different file
      </button>
    {:else}
      <p class="how-card__body">Drop any file here — or click to pick one. Nothing uploads.</p>
    {/if}
  </div>

  <div class="how-card__connector" aria-hidden="true">
    <span class="connector-line"></span>
    <span class="connector-pad"></span>
    <span class="connector-line"></span>
  </div>

  <!-- 02 — Pick -->
  <div class="how-card" class:how-card--active={file && compatibleTools.length > 0}>
    <div class="how-card__num">02</div>
    <div class="how-card__verb">Pick.</div>
    {#if !file}
      <p class="how-card__body">After you drop, the tools that can act on your file appear here.</p>
    {:else if compatibleTools.length === 0}
      <p class="how-card__body">No matching tools — try a different file type.</p>
    {:else}
      <p class="how-card__body">{compatibleTools.length} tool{compatibleTools.length === 1 ? '' : 's'} can act on this file:</p>
      <div class="how-card__tools" role="listbox" aria-label="Compatible tools">
        {#each previewTools as t}
          <button
            class="how-card__tool"
            class:how-card__tool--picked={pickedToolId === t.id}
            on:click={() => pickTool(t.id)}
            type="button"
            role="option"
            aria-selected={pickedToolId === t.id}
          >{fmtName(t)}</button>
        {/each}
        {#if extraCount > 0}
          <a class="how-card__more" href="/tools" aria-label="See all compatible tools">+{extraCount} more</a>
        {/if}
      </div>
    {/if}
  </div>

  <div class="how-card__connector" aria-hidden="true">
    <span class="connector-line"></span>
    <span class="connector-pad"></span>
    <span class="connector-line"></span>
  </div>

  <!-- 03 — Run -->
  <div class="how-card" class:how-card--active={!!pickedTool}>
    <div class="how-card__num">03</div>
    <div class="how-card__verb">Run.</div>
    {#if !file}
      <p class="how-card__body">Click Run to open the tool with your file ready.</p>
    {:else if !pickedTool}
      <p class="how-card__body">Pick a tool above to enable Run.</p>
    {:else}
      <p class="how-card__body">Press Run — your file lands inside <strong>{pickedTool.name}</strong>, ready to go.</p>
    {/if}
    <button
      class="how-card__run"
      on:click={run}
      disabled={!pickedTool}
      type="button"
    >
      {pickedTool ? `Run ${pickedTool.name} →` : 'Run'}
    </button>
  </div>
</div>

<style>
  .how-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    gap: var(--space-3);
    align-items: stretch;
  }

  @media (max-width: 900px) {
    .how-row {
      grid-template-columns: 1fr;
    }
    .how-card__connector {
      display: none;
    }
  }

  .how-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    min-height: 200px;
    cursor: default;
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      background var(--duration-instant) var(--ease-sharp);
  }

  .how-card[role='button'] {
    cursor: pointer;
  }

  .how-card[role='button']:hover,
  .how-card[role='button']:focus-visible {
    border-color: var(--accent-hover);
    background: var(--bg-raised);
  }

  .how-card[role='button']:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .how-card--dragover {
    border-style: solid;
    border-color: var(--accent-hover);
    background: var(--accent-dim);
  }

  .how-card--active {
    border-style: solid;
    border-color: var(--border);
  }

  .how-card__num {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    color: var(--text-subtle);
    letter-spacing: -0.02em;
  }

  .how-card__verb {
    font-family: var(--font-sans);
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .how-card__body {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.45;
    margin: 0;
  }

  .how-card__filename {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    display: block;
  }

  .how-card__filemeta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .how-card__change {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    margin-top: auto;
  }

  .how-card__change:hover {
    color: var(--text-primary);
  }

  .how-card__tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: auto;
  }

  .how-card__tool {
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color var(--duration-instant) var(--ease-sharp),
      color var(--duration-instant) var(--ease-sharp);
  }

  .how-card__tool:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .how-card__tool--picked {
    border-color: var(--accent-hover);
    color: var(--accent-text);
    background: var(--accent-dim);
  }

  .how-card__tool:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .how-card__more {
    height: 28px;
    padding: 0 var(--space-3);
    display: inline-flex;
    align-items: center;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  .how-card__more:hover {
    color: var(--text-muted);
  }

  .how-card__run {
    height: 36px;
    padding: 0 var(--space-4);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    margin-top: auto;
    align-self: flex-start;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      transform var(--duration-instant) var(--ease-sharp);
  }

  .how-card__run:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .how-card__run:active:not(:disabled) {
    transform: scale(0.98);
  }

  .how-card__run:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }

  .how-card__run:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .how-card__connector {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .connector-line {
    display: block;
    width: 16px;
    height: 1px;
    background: var(--border);
  }

  .connector-pad {
    display: block;
    width: 4px;
    height: 4px;
    background: var(--accent);
    flex-shrink: 0;
  }
</style>
