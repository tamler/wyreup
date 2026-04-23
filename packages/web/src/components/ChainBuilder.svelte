<script lang="ts">
  import { onMount } from 'svelte';
  import DropZone from './runners/DropZone.svelte';
  import ParamsForm from './runners/ParamsForm.svelte';
  import ProgressBar from './runners/ProgressBar.svelte';
  import { encodeChainSteps, decodeChainSteps } from './runners/chainUrl';
  import { saveChain } from './runners/kitStorage';
  import type { ToolProgress, ParamFieldSchema } from '@wyreup/core';

  interface ToolSummary {
    id: string;
    name: string;
    description: string;
    inputAccept: string[];
    inputMin: number;
    outputMime: string;
    defaults: Record<string, unknown>;
    paramSchema?: Record<string, ParamFieldSchema>;
  }

  export let tools: ToolSummary[] = [];

  // Chain state: each step has a toolId + params
  interface BuildStep {
    toolId: string;
    params: Record<string, unknown>;
    expanded: boolean;
  }

  let steps: BuildStep[] = [];
  let inputFiles: File[] = [];
  let dropError = '';

  $: inputFile = inputFiles[0] ?? null;

  type RunState = 'idle' | 'running' | 'done' | 'error';
  let runState: RunState = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0 };
  let stepStatuses: Array<'pending' | 'running' | 'done' | 'error'> = [];
  let errorMsg = '';

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;

  let shareConfirm = false;
  let shareTimer: ReturnType<typeof setTimeout> | null = null;
  let saveConfirm = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveName = '';
  let showSaveDialog = false;
  // Post-run inline save prompt
  let showEndOfRunPrompt = false;
  let endOfRunSaved = false;

  // Build compatible tool list for a given MIME (or all if null)
  function toolsForMime(mime: string | null): ToolSummary[] {
    if (!mime) return tools;
    return tools.filter((t) => {
      if (t.inputMin === 0) return false; // generators, skip
      return t.inputAccept.some((p) => {
        if (p === '*' || p === '*/*') return true;
        if (p.endsWith('/*')) return mime.startsWith(p.slice(0, -1));
        return mime === p;
      });
    });
  }

  function getOutputMime(toolId: string): string | null {
    const t = tools.find((x) => x.id === toolId);
    return t?.outputMime ?? null;
  }

  function getDefaults(toolId: string): Record<string, unknown> {
    const t = tools.find((x) => x.id === toolId);
    return t?.defaults ?? {};
  }

  function getParamSchema(toolId: string): Record<string, ParamFieldSchema> | undefined {
    const t = tools.find((x) => x.id === toolId);
    return t?.paramSchema;
  }

  function prevOutputMime(idx: number): string | null {
    if (idx === 0) return inputFile ? inputFile.type : null;
    const prev = steps[idx - 1];
    if (!prev || !prev.toolId) return null;
    return getOutputMime(prev.toolId);
  }

  function availableTools(idx: number): ToolSummary[] {
    const mime = prevOutputMime(idx);
    return toolsForMime(mime);
  }

  function addStep() {
    steps = [...steps, { toolId: '', params: {}, expanded: false }];
    stepStatuses = [...stepStatuses, 'pending'];
  }

  function removeStep(idx: number) {
    steps = steps.filter((_, i) => i !== idx);
    stepStatuses = stepStatuses.filter((_, i) => i !== idx);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const arr = [...steps];
    [arr[idx - 1], arr[idx]] = [arr[idx]!, arr[idx - 1]!];
    steps = arr;
  }

  function moveDown(idx: number) {
    if (idx === steps.length - 1) return;
    const arr = [...steps];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1]!, arr[idx]!];
    steps = arr;
  }

  function selectTool(idx: number, toolId: string) {
    const s = [...steps];
    s[idx] = { ...s[idx]!, toolId, params: getDefaults(toolId), expanded: false };
    steps = s;
    updateUrl();
  }

  function updateParams(idx: number, params: Record<string, unknown>) {
    const s = [...steps];
    s[idx] = { ...s[idx]!, params };
    steps = s;
    updateUrl();
  }

  function toggleExpand(idx: number) {
    const s = [...steps];
    s[idx] = { ...s[idx]!, expanded: !s[idx]!.expanded };
    steps = s;
  }

  $: validSteps = steps.filter((s) => s.toolId);
  $: canRun = validSteps.length > 0 && inputFile !== null && runState !== 'running';
  $: chainSpec = validSteps.map((s) => ({ toolId: s.toolId, params: s.params }));

  function updateUrl() {
    if (typeof window === 'undefined') return;
    const encoded = encodeChainSteps(chainSpec);
    const url = new URL(window.location.href);
    if (encoded) {
      url.searchParams.set('steps', encoded);
    } else {
      url.searchParams.delete('steps');
    }
    window.history.replaceState({}, '', url.toString());
  }

  onMount(() => {
    const url = new URL(window.location.href);
    const stepsParam = url.searchParams.get('steps');
    if (stepsParam) {
      const decoded = decodeChainSteps(stepsParam);
      if (decoded) {
        steps = decoded.map((d) => ({
          toolId: d.toolId,
          params: { ...getDefaults(d.toolId), ...d.params },
          expanded: false,
        }));
        stepStatuses = decoded.map(() => 'pending' as const);
      }
    }
  });

  async function run() {
    if (!canRun || !inputFile) return;
    runState = 'running';
    errorMsg = '';
    resultBlob = null;
    showEndOfRunPrompt = false;
    endOfRunSaved = false;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    stepStatuses = validSteps.map(() => 'pending' as const);

    try {
      const { runChain, createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const ac = new AbortController();
      const cache = new Map<string, unknown>();

      let currentStepIdx = 0;
      const chain = chainSpec;

      const result = await runChain(
        chain,
        [inputFile],
        {
          onProgress: (p) => {
            progress = p;
            const s = [...stepStatuses];
            s[currentStepIdx] = 'running';
            stepStatuses = s;
          },
          signal: ac.signal,
          cache,
          executionId: crypto.randomUUID(),
        },
        registry,
      );

      // Mark each step done sequentially after the run completes
      // (runChain is synchronous per-step so we mark all done)
      stepStatuses = validSteps.map(() => 'done' as const);

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      runState = 'done';
      // Auto-show save prompt after successful run
      saveName = validSteps.map((s) => s.toolId).join('-');
      showEndOfRunPrompt = true;
    } catch (err) {
      runState = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function confirmEndOfRunSave() {
    if (!saveName.trim()) return;
    const now = new Date().toISOString();
    saveChain({
      id: crypto.randomUUID(),
      name: saveName.trim(),
      steps: chainSpec,
      createdAt: now,
      updatedAt: now,
    });
    endOfRunSaved = true;
    showEndOfRunPrompt = false;
  }

  function dismissEndOfRunPrompt() {
    showEndOfRunPrompt = false;
  }

  function reset() {
    runState = 'idle';
    errorMsg = '';
    resultBlob = null;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
  }

  function download() {
    if (!resultUrl || !resultBlob) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    const ext = resultBlob.type.split('/')[1] ?? 'bin';
    a.download = `chain-result.${ext}`;
    a.click();
  }

  function shareChain() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      shareConfirm = true;
      if (shareTimer) clearTimeout(shareTimer);
      shareTimer = setTimeout(() => { shareConfirm = false; }, 1500);
    }).catch(() => {});
  }

  function openSaveDialog() {
    saveName = validSteps.map((s) => s.toolId).join(' → ');
    showSaveDialog = true;
  }

  function confirmSave() {
    if (!saveName.trim()) return;
    const now = new Date().toISOString();
    saveChain({
      id: crypto.randomUUID(),
      name: saveName.trim(),
      steps: chainSpec,
      createdAt: now,
      updatedAt: now,
    });
    showSaveDialog = false;
    saveConfirm = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveConfirm = false; }, 1500);
  }

  function onSelectTool(idx: number, e: Event) {
    selectTool(idx, (e.target as HTMLSelectElement).value);
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }
</script>

<div class="chain-builder">
  <!-- Drop zone at top -->
  <DropZone
    accept={['*/*']}
    multiple={false}
    bind:files={inputFiles}
    bind:error={dropError}
    label="Drop input file or click to browse"
    on:files={(e) => {
      inputFiles = e.detail;
      dropError = '';
      reset();
    }}
  />

  <!-- Steps -->
  <div class="steps-stack">
    {#each steps as step, idx}
      {@const avail = availableTools(idx)}
      <div class="step-card" class:step-card--error={stepStatuses[idx] === 'error'} class:step-card--done={stepStatuses[idx] === 'done'}>
        <div class="step-header">
          <span class="step-num">{String(idx + 1).padStart(2, '0')}</span>

          <!-- Tool selector -->
          <select
            class="tool-select"
            value={step.toolId}
            on:change={(e) => onSelectTool(idx, e)}
          >
            <option value="">— pick a tool —</option>
            {#each avail as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>

          <!-- Step status indicator -->
          {#if stepStatuses[idx] === 'done'}
            <span class="step-status step-status--done">done</span>
          {:else if stepStatuses[idx] === 'running'}
            <span class="step-status step-status--running">running</span>
          {/if}

          <div class="step-actions">
            {#if step.toolId && Object.keys(getDefaults(step.toolId)).length > 0}
              <button class="btn-ghost-sm" type="button" on:click={() => toggleExpand(idx)}>
                {step.expanded ? 'hide params' : 'params'}
              </button>
            {/if}
            <button class="btn-ghost-sm" type="button" on:click={() => moveUp(idx)} disabled={idx === 0} aria-label="Move step up">↑</button>
            <button class="btn-ghost-sm" type="button" on:click={() => moveDown(idx)} disabled={idx === steps.length - 1} aria-label="Move step down">↓</button>
            <button class="btn-ghost-sm btn-ghost-sm--danger" type="button" on:click={() => removeStep(idx)} aria-label="Remove step">×</button>
          </div>
        </div>

        <!-- Output type indicator -->
        {#if step.toolId}
          {@const mime = getOutputMime(step.toolId)}
          {#if mime}
            <div class="step-output-mime">
              <span class="solder-key">output</span>
              <span class="solder-rule" aria-hidden="true"></span>
              <span class="solder-pad" aria-hidden="true"></span>
              <span class="solder-val">{mime}</span>
            </div>
          {/if}
        {/if}

        <!-- Params form (collapsed by default) -->
        {#if step.expanded && step.toolId}
          <div class="step-params">
            <ParamsForm
              defaults={getDefaults(step.toolId)}
              paramSchema={getParamSchema(step.toolId)}
              params={step.params}
              on:change={(e) => updateParams(idx, e.detail)}
            />
          </div>
        {/if}
      </div>

      <!-- Connector between steps -->
      {#if idx < steps.length - 1}
        <div class="step-connector" aria-hidden="true">
          <span class="connector-line"></span>
          <span class="connector-node"></span>
          <span class="connector-line"></span>
        </div>
      {/if}
    {/each}

    <button class="btn-add-step" type="button" on:click={addStep}>
      + Add step
    </button>
  </div>

  <!-- Run button -->
  {#if steps.length > 0}
    <div class="run-row">
      <button
        class="btn-primary"
        type="button"
        on:click={run}
        disabled={!canRun}
      >
        {runState === 'running' ? 'Running...' : 'Run chain'}
      </button>

      {#if validSteps.length > 0}
        <button class="btn-secondary" type="button" on:click={shareChain}>
          Share
        </button>
        {#if shareConfirm}
          <span class="confirm-msg" aria-live="polite">Chain URL copied.</span>
        {/if}

        <button class="btn-secondary" type="button" on:click={openSaveDialog}>
          Save to Chains
        </button>
        {#if saveConfirm}
          <span class="confirm-msg" aria-live="polite">Saved.</span>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Save dialog (manual trigger from run row) -->
  {#if showSaveDialog}
    <div class="save-dialog" role="dialog" aria-modal="true" aria-label="Save chain">
      <p class="save-dialog__label">Chain name</p>
      <input
        class="save-dialog__input"
        type="text"
        bind:value={saveName}
        placeholder="My chain"
        on:keydown={(e) => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') showSaveDialog = false; }}
      />
      <div class="save-dialog__actions">
        <button class="btn-primary" type="button" on:click={confirmSave} disabled={!saveName.trim()}>Save</button>
        <button class="btn-ghost-sm" type="button" on:click={() => showSaveDialog = false}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Progress -->
  {#if runState === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  <!-- Error -->
  {#if runState === 'error'}
    <div class="error-panel" role="alert">
      <span class="panel-label error-label">Error</span>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" type="button" on:click={reset}>Try again</button>
    </div>
  {/if}

  <!-- Result -->
  {#if runState === 'done' && resultBlob && resultUrl}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
        </div>
        <div class="panel-divider"></div>

        {#if resultBlob.type.startsWith('image/')}
          <img class="result-img" src={resultUrl} alt="Chain result" />
        {:else}
          <div class="solder-row">
            <span class="solder-key">Output</span>
            <span class="solder-rule" aria-hidden="true"></span>
            <span class="solder-pad" aria-hidden="true"></span>
            <span class="solder-val">{resultBlob.type}</span>
          </div>
        {/if}

        <div class="solder-row">
          <span class="solder-key">Size</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{formatBytes(resultBlob.size)}</span>
        </div>

        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-primary" type="button" on:click={download}>Download result</button>
          <button class="btn-secondary" type="button" on:click={openSaveDialog}>Save to Chains</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- End-of-run save prompt -->
  {#if showEndOfRunPrompt}
    <div class="end-save-prompt" role="region" aria-label="Save this chain">
      <p class="end-save-prompt__label">Save this chain to your collection?</p>
      <div class="end-save-prompt__row">
        <input
          class="end-save-prompt__input"
          type="text"
          bind:value={saveName}
          placeholder="Chain name"
          aria-label="Chain name"
          on:keydown={(e) => { if (e.key === 'Enter') confirmEndOfRunSave(); if (e.key === 'Escape') dismissEndOfRunPrompt(); }}
        />
        <button class="btn-primary" type="button" on:click={confirmEndOfRunSave} disabled={!saveName.trim()}>Save chain</button>
        <button class="btn-ghost-sm" type="button" on:click={dismissEndOfRunPrompt}>Skip</button>
      </div>
    </div>
  {/if}

  {#if endOfRunSaved}
    <p class="end-save-confirm" aria-live="polite">Saved to your Chains. <a href="/chains" class="end-save-link">View Chains</a></p>
  {/if}
</div>

<style>
  .chain-builder {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .steps-stack {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Step card */
  .step-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    transition: border-color var(--duration-fast) var(--ease-sharp);
  }

  .step-card--done {
    border-color: var(--success);
  }

  .step-card--error {
    border-color: var(--danger);
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .step-num {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.08em;
    flex-shrink: 0;
    min-width: 24px;
  }

  .tool-select {
    flex: 1;
    min-width: 160px;
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .tool-select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .step-status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .step-status--done { color: var(--success); }
  .step-status--running { color: var(--accent); }

  .step-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-left: auto;
    flex-shrink: 0;
  }

  .step-output-mime {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: 36px;
  }

  .step-params {
    padding-left: 36px;
  }

  /* Step connector */
  .step-connector {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    gap: 0;
  }

  .connector-line {
    display: block;
    width: 1px;
    height: 8px;
    background: var(--border);
  }

  .connector-node {
    display: block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    flex-shrink: 0;
  }

  /* Add step button */
  .btn-add-step {
    margin-top: var(--space-3);
    align-self: flex-start;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    transition:
      color var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-add-step:hover {
    color: var(--text-muted);
    border-color: var(--text-subtle);
  }

  .btn-add-step:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Run row */
  .run-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .confirm-msg {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent);
  }

  /* Save dialog */
  .save-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .save-dialog__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .save-dialog__input {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .save-dialog__input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .save-dialog__actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  /* Buttons */
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
    transition:
      background var(--duration-instant) var(--ease-sharp),
      transform var(--duration-instant) var(--ease-sharp);
  }

  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .btn-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .btn-ghost-sm {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0 var(--space-1);
    min-height: 24px;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .btn-ghost-sm:hover { color: var(--text-muted); }
  .btn-ghost-sm:disabled { opacity: 0.3; cursor: not-allowed; }
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn-ghost-sm--danger:hover { color: var(--danger); }

  /* Error panel */
  .error-panel {
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .error-label { color: var(--danger); }

  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .panel-divider {
    height: 1px;
    background: var(--border-subtle);
  }

  /* Result panel */
  .result-panel {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    overflow: visible;
  }

  .result-panel__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .result-img {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    background: var(--bg);
    align-self: flex-start;
  }

  .result-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  /* Solder rows */
  .solder-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 20px;
  }

  .solder-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 60px;
    flex-shrink: 0;
  }

  .solder-rule {
    flex: 1;
    height: 1px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .solder-pad {
    width: 3px;
    height: 3px;
    background: var(--border);
    flex-shrink: 0;
  }

  .solder-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
  }

  /* End-of-run save prompt */
  .end-save-prompt {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .end-save-prompt__label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .end-save-prompt__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .end-save-prompt__input {
    flex: 1;
    min-width: 160px;
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .end-save-prompt__input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .end-save-confirm {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .end-save-link {
    color: var(--accent);
    text-decoration: none;
  }

  .end-save-link:hover {
    text-decoration: underline;
  }

  /* Corner bracket motif */
  .brackets::before,
  .brackets::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .brackets::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--accent);
    border-left: 1px solid var(--accent);
  }

  .brackets::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
  }

  .brackets-inner {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .brackets-inner::before,
  .brackets-inner::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .brackets-inner::before {
    top: -5px;
    right: -5px;
    border-top: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
  }

  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--accent);
    border-left: 1px solid var(--accent);
  }
</style>
