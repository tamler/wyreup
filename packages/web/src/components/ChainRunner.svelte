<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DropZone from './runners/DropZone.svelte';
  import ProgressBar from './runners/ProgressBar.svelte';
  import BatchFolderRun from './BatchFolderRun.svelte';
  import { decodeChainSteps } from './runners/chainUrl';
  import { saveChain } from './runners/toolbeltStorage';
  import { peekChainFile, consumeChainFile } from './runners/chainStorage';
  import type { ToolProgress } from '@wyreup/core';

  interface ToolSummary {
    id: string;
    name: string;
    outputMime: string;
    defaults: Record<string, unknown>;
    installSize?: number;
    installGroup?: string;
  }

  export let tools: ToolSummary[] = [];
  export let stepsParam: string = '';

  interface ResolvedStep {
    toolId: string;
    name: string;
    params: Record<string, unknown>;
    valid: boolean;
    installSize: number;
    installGroup: string | undefined;
  }

  // Persisted per-chain auto-run consent. Keyed by a hash of the
  // step string so the same chain can auto-run on repeat visits, but
  // a different chain in the same `auto=1` URL still has to be
  // confirmed once.
  const CONSENT_KEY = 'wyreup:chain-autorun-consent';
  function loadConsents(): Record<string, number> {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch { return {}; }
  }
  function saveConsent(fingerprint: string) {
    try {
      const all = loadConsents();
      all[fingerprint] = Date.now();
      localStorage.setItem(CONSENT_KEY, JSON.stringify(all));
    } catch { /* localStorage unavailable */ }
  }
  function hasConsent(fingerprint: string): boolean {
    const all = loadConsents();
    return typeof all[fingerprint] === 'number';
  }

  let resolvedSteps: ResolvedStep[] = [];
  let invalidIds: string[] = [];
  let parseError = false;
  let chainName = '';
  let stepsFingerprint = '';
  let pendingAutoRun = false;
  let totalInstallSize = 0;

  let inputFiles: File[] = [];
  let dropError = '';

  $: inputFile = inputFiles[0] ?? null;

  type RunState = 'idle' | 'running' | 'done' | 'error';
  let runState: RunState = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0 };
  let errorMsg = '';

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;

  let saveConfirm = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveName = '';
  let showSaveDialog = false;
  // Post-run inline save prompt
  let showEndOfRunPrompt = false;
  let endOfRunSaved = false;

  onMount(() => {
    const url = new URL(window.location.href);
    const src = stepsParam || url.searchParams.get('steps') || '';
    if (!src) {
      parseError = true;
      return;
    }
    const decoded = decodeChainSteps(src);
    if (!decoded) {
      parseError = true;
      return;
    }
    // Optional ?name=<urlencoded> for shareable chains. Cap to 80 chars
    // and strip control chars to avoid weird display.
    const rawName = url.searchParams.get('name') ?? '';
    chainName = rawName
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '')
      .slice(0, 80)
      .trim();
    resolvedSteps = decoded.map((d) => {
      const tool = tools.find((t) => t.id === d.toolId);
      if (!tool) {
        invalidIds.push(d.toolId);
        return { toolId: d.toolId, name: d.toolId, params: d.params, valid: false, installSize: 0, installGroup: undefined };
      }
      return {
        toolId: d.toolId,
        name: tool.name,
        params: { ...tool.defaults, ...d.params },
        valid: true,
        installSize: tool.installSize ?? 0,
        installGroup: tool.installGroup,
      };
    });
    invalidIds = [...new Set(invalidIds)];

    // Compute the chain's total install footprint (sum of distinct
    // installGroups so a chain that uses two tools from the same
    // group only counts once).
    const seenGroups = new Set<string>();
    let footprint = 0;
    for (const s of resolvedSteps) {
      if (!s.valid) continue;
      const groupKey = s.installGroup ?? `__solo:${s.toolId}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      footprint += s.installSize;
    }
    totalInstallSize = footprint;
    stepsFingerprint = src;

    // Pull a chained-in file off chainStorage if one is waiting (e.g. a
    // trigger handed off via /chain/run?auto=1, or an upstream tool's
    // result stashed for this chain). Then, if `auto=1` is in the URL,
    // kick off run() automatically once Svelte has reflected state.
    void (async () => {
      const peeked = await peekChainFile();
      if (peeked) {
        const file = await consumeChainFile();
        if (file) inputFiles = [file];
      }
      if (url.searchParams.get('auto') === '1') {
        await tick();
        if (inputFiles.length > 0 && resolvedSteps.length > 0 && invalidIds.length === 0) {
          // Auto-run consent gate — chains with any heavy install
          // footprint (AI/ML models) must get explicit confirmation
          // on first sight. Once confirmed, the consent persists
          // so repeat visits run hands-free.
          if (totalInstallSize > 0 && !hasConsent(stepsFingerprint)) {
            pendingAutoRun = true;
            return;
          }
          void run();
        }
      }
    })();
  });

  function approveAutoRun() {
    saveConsent(stepsFingerprint);
    pendingAutoRun = false;
    void run();
  }

  function declineAutoRun() {
    pendingAutoRun = false;
  }

  function fmtSize(bytes: number): string {
    if (bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${Math.round(mb * 1024)} KB`;
    if (mb < 1024) return `${Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  $: editUrl = `/chain/build?steps=${stepsParam || (typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('steps') ?? '' : '')}`;

  $: canRun = resolvedSteps.length > 0 && invalidIds.length === 0 && inputFile !== null && runState !== 'running';

  async function run() {
    if (!canRun || !inputFile) return;
    runState = 'running';
    errorMsg = '';
    resultBlob = null;
    showEndOfRunPrompt = false;
    endOfRunSaved = false;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }

    try {
      const { runChain, createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const ac = new AbortController();
      const cache = new Map<string, unknown>();

      const chain = resolvedSteps.map((s) => ({ toolId: s.toolId, params: s.params }));

      const result = await runChain(
        chain,
        [inputFile],
        {
          onProgress: (p) => { progress = p; },
          signal: ac.signal,
          cache,
          executionId: crypto.randomUUID(),
        },
        registry,
      );

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      runState = 'done';
      // Auto-show save prompt after successful run
      saveName = resolvedSteps.map((s) => s.name).join('-');
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
      steps: resolvedSteps.map((s) => ({ toolId: s.toolId, params: s.params })),
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

  function openSaveDialog() {
    saveName = resolvedSteps.map((s) => s.name).join(' → ');
    showSaveDialog = true;
  }

  function confirmSave() {
    if (!saveName.trim()) return;
    const now = new Date().toISOString();
    saveChain({
      id: crypto.randomUUID(),
      name: saveName.trim(),
      steps: resolvedSteps.map((s) => ({ toolId: s.toolId, params: s.params })),
      createdAt: now,
      updatedAt: now,
    });
    showSaveDialog = false;
    saveConfirm = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveConfirm = false; }, 1500);
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }
</script>

<div class="chain-runner">
  {#if parseError}
    <div class="error-panel" role="alert">
      <span class="panel-label error-label">Invalid chain</span>
      <div class="panel-divider"></div>
      <p class="error-msg">No valid chain steps found in the URL. Check the link or build a new chain.</p>
      <div class="panel-divider"></div>
      <a href="/chain/build" class="btn-secondary">Build a chain</a>
    </div>
  {:else if invalidIds.length > 0}
    <div class="error-panel" role="alert">
      <span class="panel-label error-label">Unknown tool{invalidIds.length > 1 ? 's' : ''}</span>
      <div class="panel-divider"></div>
      <p class="error-msg">
        This chain references tool{invalidIds.length > 1 ? 's' : ''} that no longer exist{invalidIds.length === 1 ? 's' : ''}:
        {#each invalidIds as id}
          <code class="bad-id">{id}</code>{' '}
        {/each}
      </p>
      <div class="panel-divider"></div>
      <a href={editUrl} class="btn-secondary">Edit this chain</a>
    </div>
  {:else}
    {#if chainName}
      <header class="chain-name-hero">
        <span class="chain-name-hero__label">Chain</span>
        <h2 class="chain-name-hero__title">{chainName}</h2>
      </header>
    {/if}

    <!-- Chain preview -->
    <div class="chain-preview" aria-label="Chain steps">
      {#each resolvedSteps as step, idx}
        <div class="preview-node" class:preview-node--invalid={!step.valid}>
          <span class="preview-dot" aria-hidden="true"></span>
          <span class="preview-label">{step.name}</span>
        </div>
        {#if idx < resolvedSteps.length - 1}
          <span class="preview-arrow" aria-hidden="true"></span>
        {/if}
      {/each}
    </div>

    <!-- Drop zone -->
    <DropZone
      accept={['*/*']}
      multiple={false}
      bind:files={inputFiles}
      bind:error={dropError}
      label="Drop a file to run this chain"
      on:files={(e) => {
        inputFiles = e.detail;
        dropError = '';
        reset();
      }}
    />

    {#if pendingAutoRun}
      <div class="consent-panel" role="alertdialog" aria-labelledby="consent-title">
        <div class="consent-panel__head">
          <span class="consent-panel__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </span>
          <h3 id="consent-title" class="consent-panel__title">This chain will download <strong>{fmtSize(totalInstallSize)}</strong> on first run</h3>
        </div>
        <p class="consent-panel__body">
          You opened a link with auto-run enabled. Before running, confirm
          you trust this chain. Models cache for offline use after the first run.
        </p>
        <ul class="consent-panel__steps">
          {#each resolvedSteps as s}
            <li>
              <span class="consent-panel__step-name">{s.name}</span>
              {#if s.installSize > 0}
                <span class="consent-panel__step-size">{fmtSize(s.installSize)}</span>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="consent-panel__actions">
          <button class="btn-primary" type="button" on:click={approveAutoRun}>Run chain</button>
          <button class="btn-ghost-sm" type="button" on:click={declineAutoRun}>Cancel</button>
        </div>
      </div>
    {/if}

    <!-- Run button -->
    <div class="run-row">
      <button
        class="btn-primary"
        type="button"
        on:click={run}
        disabled={!canRun}
      >
        {runState === 'running' ? 'Running...' : 'Run chain'}
      </button>
      <a href={editUrl} class="btn-secondary">Edit in builder</a>
    </div>

    <!-- Batch mode (collapsed by default) -->
    <BatchFolderRun {resolvedSteps} />

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
              <span class="solder-key">Type</span>
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
            <a href={editUrl} class="btn-secondary">Edit in builder</a>
          </div>
        </div>
      </div>

      <!-- Save dialog (manual trigger) -->
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
      {#if saveConfirm}
        <span class="confirm-msg" aria-live="polite">Saved to your toolbelt.</span>
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
        <p class="end-save-confirm" aria-live="polite">Saved to your toolbelt. <a href="/toolbelt" class="end-save-link">View toolbelt</a></p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .chain-runner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Auto-run consent panel — gates drive-by AI model downloads */
  .consent-panel {
    border: 1px solid var(--accent-hover);
    border-radius: var(--radius-md);
    background: var(--accent-dim, var(--bg-elevated));
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .consent-panel__head { display: flex; align-items: center; gap: var(--space-2); }
  .consent-panel__icon { color: var(--accent-text); display: inline-flex; }
  .consent-panel__title {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .consent-panel__title strong { color: var(--accent-text); }
  .consent-panel__body {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }
  .consent-panel__steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--space-3);
  }
  .consent-panel__steps li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .consent-panel__step-name { color: var(--text-primary); }
  .consent-panel__step-size {
    font-size: var(--text-xs);
    color: var(--text-subtle);
    font-weight: 500;
  }
  .consent-panel__actions { display: flex; gap: var(--space-2); align-items: center; }

  /* Chain-name hero (shown when ?name= present in URL) */
  .chain-name-hero {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) 0;
  }

  .chain-name-hero__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-text);
  }

  .chain-name-hero__title {
    font-family: var(--font-sans);
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
    word-break: break-word;
  }

  /* Chain preview */
  .chain-preview {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    row-gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .preview-node {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    white-space: nowrap;
  }

  .preview-node--invalid {
    border-color: var(--danger);
    background: rgba(239, 68, 68, 0.08);
  }

  .preview-dot {
    display: block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    flex-shrink: 0;
  }

  .preview-label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
  }

  .preview-arrow {
    display: block;
    width: 24px;
    height: 1px;
    background: var(--border);
    flex-shrink: 0;
    position: relative;
  }

  .preview-arrow::after {
    content: '';
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 4px;
    border-right: 1px solid var(--border);
    border-top: 1px solid var(--border);
    rotate: 45deg;
  }

  /* Run row */
  .run-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .bad-id {
    font-family: var(--font-mono);
    background: var(--bg-raised);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--danger);
    color: var(--danger);
  }

  .confirm-msg {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-text);
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

  .save-dialog__input:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled { background: var(--bg-raised); color: var(--text-subtle); cursor: not-allowed; }
  .btn-primary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

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

  .panel-header { display: flex; justify-content: space-between; align-items: center; }

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

  .panel-divider { height: 1px; background: var(--border-subtle); }

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

  .result-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }

  .solder-row { display: flex; align-items: center; gap: var(--space-2); min-height: 20px; }
  .solder-key { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); min-width: 60px; flex-shrink: 0; }
  .solder-rule { flex: 1; height: 1px; border-bottom: 1px solid var(--border-subtle); }
  .solder-pad { width: 3px; height: 3px; background: var(--border); flex-shrink: 0; }
  .solder-val { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); font-weight: 500; }

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
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .end-save-confirm {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .end-save-link {
    color: var(--accent-text);
    text-decoration: none;
  }

  .end-save-link:hover { text-decoration: underline; }

  /* Corner bracket motif */
  .brackets::before, .brackets::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }

  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent-hover); border-right: 1px solid var(--accent-hover); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent-hover); border-left: 1px solid var(--accent-hover); }
</style>
