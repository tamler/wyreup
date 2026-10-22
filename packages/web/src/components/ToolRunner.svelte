<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ComponentType } from 'svelte';
  import type { SerializedTool, PreloadAdmission } from './runners/types';
  import { VARIANT_MAP, type RunnerVariant } from './runners/variantMap';
  import { clearChainHandover, peekChainHandover } from './runners/chainStorage';
  import { clearTrail, getTrailHandover } from './runners/hopTrail';
  import { acceptsBrowserFile } from '../lib/file-tool-candidates';
  import { user, authReady } from '../stores/user';
  import ProBadge from './ProBadge.svelte';
  import BuyCreditsSheet from './BuyCreditsSheet.svelte';

  // Dynamic-import map: each runner becomes its own Vite chunk, fetched only
  // when the matching tool page mounts, keeping the component bodies out of
  // the initial ToolRunner chunk.
  // The keys match the RunnerVariant union; TS will error if a variant is added
  // to variantMap without a loader here.
  const variantLoaders: Record<RunnerVariant, () => Promise<{ default: ComponentType }>> = {
    SimpleImageRunner: () => import('./runners/SimpleImageRunner.svelte'),
    PreviewRunner: () => import('./runners/PreviewRunner.svelte'),
    MultiInputRunner: () => import('./runners/MultiInputRunner.svelte'),
    MultiOutputRunner: () => import('./runners/MultiOutputRunner.svelte'),
    JsonResultRunner: () => import('./runners/JsonResultRunner.svelte'),
    TextResultRunner: () => import('./runners/TextResultRunner.svelte'),
    TextInputRunner: () => import('./runners/TextInputRunner.svelte'),
    TwoTextInputRunner: () => import('./runners/TwoTextInputRunner.svelte'),
    GenerateRunner: () => import('./runners/GenerateRunner.svelte'),
    CompoundInterestRunner: () => import('./runners/CompoundInterestRunner.svelte'),
    InvestmentDcaRunner: () => import('./runners/InvestmentDcaRunner.svelte'),
    PercentageCalculatorRunner: () => import('./runners/PercentageCalculatorRunner.svelte'),
    DateCalculatorRunner: () => import('./runners/DateCalculatorRunner.svelte'),
    PdfRedactRunner: () => import('./runners/PdfRedactRunner.svelte'),
    PdfCropRunner: () => import('./runners/PdfCropRunner.svelte'),
    RecordAudioRunner: () => import('./runners/RecordAudioRunner.svelte'),
    ColorPaletteRunner: () => import('./runners/ColorPaletteRunner.svelte'),
    ColorHarmonyRunner: () => import('./runners/ColorHarmonyRunner.svelte'),
    HashRunner: () => import('./runners/HashRunner.svelte'),
    ColorConverterRunner: () => import('./runners/ColorConverterRunner.svelte'),
    ImageInfoRunner: () => import('./runners/ImageInfoRunner.svelte'),
    PdfInfoRunner: () => import('./runners/PdfInfoRunner.svelte'),
    PdfMetadataRunner: () => import('./runners/PdfMetadataRunner.svelte'),
    QrReaderRunner: () => import('./runners/QrReaderRunner.svelte'),
    ImageSimilarityRunner: () => import('./runners/ImageSimilarityRunner.svelte'),
    TrimMediaRunner: () => import('./runners/TrimMediaRunner.svelte'),
    ZipInfoRunner: () => import('./runners/ZipInfoRunner.svelte'),
    ExcelInfoRunner: () => import('./runners/ExcelInfoRunner.svelte'),
    VideoConcatRunner: () => import('./runners/VideoConcatRunner.svelte'),
    FinanceRunner: () => import('./runners/FinanceRunner.svelte'),
    PlanningRowsRunner: () => import('./runners/PlanningRowsRunner.svelte'),
    PhotographyContractRunner: () => import('./runners/PhotographyContractRunner.svelte'),
    TimerRunner: () => import('./runners/TimerRunner.svelte'),
    SeatingChartRunner: () => import('./runners/SeatingChartRunner.svelte'),
    NamesRunner: () => import('./runners/NamesRunner.svelte'),
    UtilityRunner: () => import('./runners/UtilityRunner.svelte'),
    GeneratorRunner: () => import('./runners/GeneratorRunner.svelte'),
    GradientPreview: () => import('./runners/GradientPreview.svelte'),
    PsdPngRunner: () => import('./runners/PsdPngRunner.svelte'),
    CsvViewerRunner: () => import('./runners/CsvViewerRunner.svelte'),
    BankStatementRunner: () => import('./runners/BankStatementRunner.svelte'),
    StlContourRunner: () => import('./runners/StlContourRunner.svelte'),
    MidiPitchRunner: () => import('./runners/MidiPitchRunner.svelte'),
    BuildingRowsRunner: () => import('./runners/BuildingRowsRunner.svelte'),
    ConstructionEstimateRunner: () => import('./runners/ConstructionEstimateRunner.svelte'),
    GamepadRunner: () => import('./runners/GamepadRunner.svelte'),
    TouchscreenRunner: () => import('./runners/TouchscreenRunner.svelte'),
    LiveTextRunner: () => import('./runners/LiveTextRunner.svelte'),
  };

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  let chainFile: File | null = null;
  let handover: Extract<Awaited<ReturnType<typeof peekChainHandover>>, { file: File }> | null = null;
  let recoveryMessage = '';
  let dismissedFile: File | null = null;
  let admittedFile: File | null = null;
  let editorMode: 'automatic' | 'manual' = 'automatic';
  let attemptGeneration = 0;
  let mountGeneration = 0;
  const consumedTokens = new Set<string>();
  const pendingConsumptions = new Map<string, Promise<boolean>>();
  let mounted = false;
  let priorToolId = tool.id;
  let priorExternalFile = preloadedFile;
  const downloadUrls = new Set<string>();
  const downloadTimers = new Set<ReturnType<typeof setTimeout>>();

  onMount(() => {
    mounted = true;
    const own = attemptGeneration;
    void peekChainHandover().then((peeked) => {
      if (!mounted || own !== attemptGeneration) return;
      if (!peeked) { clearTrail(); return; }
      if (peeked.kind === 'unavailable') {
        recoveryMessage = peeked.message;
        clearTrail();
        return;
      }
      handover = peeked;
      const trail = getTrailHandover();
      if (!trail || trail.token !== peeked.token || trail.targetToolId !== tool.id || peeked.targetToolId !== tool.id)
        clearTrail();
      if (peeked.kind === 'recoverable') recoveryMessage = peeked.message;
      if (peeked.intentValid && peeked.autoAccept === true && peeked.targetToolId === tool.id)
        acceptChain();
    }).catch(() => { if (mounted && own === attemptGeneration) recoveryMessage = 'Could not recover the stored file.'; });
  });

  function acceptChain() {
    const file = handover?.file ?? preloadedFile;
    if (!file) return;
    if (!canStage(file)) {
      recoveryMessage = automaticText && editorMode === 'automatic' && file.size > 1024 * 1024
        ? 'This file exceeds the automatic editor limit. Select Manual/file, then use the original.'
        : 'This runner cannot import this file. Download the original or choose a compatible tool.';
      return;
    }
    attemptGeneration++;
    mountGeneration++;
    dismissedFile = null;
    admittedFile = null;
    chainFile = file;
    recoveryMessage = '';
  }

  async function dismissChain() {
    const file = recoveryFile;
    if (!file) return;
    const own = attemptGeneration;
    const token = handover?.file === file ? handover.token : null;
    if (token && !await consumeToken(token)) {
      if (mounted && own === attemptGeneration) recoveryMessage = 'Stored file changed or could not be cleared. The original remains available here.';
      return;
    }
    if (!mounted || own !== attemptGeneration || recoveryFile !== file) return;
    attemptGeneration++;
    if (effectivePreloaded === file) chainFile = file;
    dismissedFile = file;
    handover = null;
    recoveryMessage = token ? '' : 'Dismissed from this page. No shared record was deleted without a token.';
    clearTrail();
  }

  function canStage(file: File): boolean {
    return !unsupported && acceptsBrowserFile(tool, file)
      && !(automaticText && editorMode === 'automatic' && file.size > 1024 * 1024);
  }

  function selectEditorMode(mode: 'automatic' | 'manual') {
    if (editorMode === mode) return;
    editorMode = mode;
    attemptGeneration++;
    mountGeneration++;
    if (chainFile === dismissedFile) chainFile = null;
    recoveryMessage = '';
  }

  function consumeToken(token: string): Promise<boolean> {
    if (consumedTokens.has(token)) return Promise.resolve(true);
    const pending = pendingConsumptions.get(token);
    if (pending) return pending;
    const operation = clearChainHandover(token).then((consumed) => {
      if (consumed) consumedTokens.add(token);
      return consumed;
    }).finally(() => { pendingConsumptions.delete(token); });
    pendingConsumptions.set(token, operation);
    return operation;
  }

  function admissionFor(id: string, file: File | null, own: number) {
    return async (result: PreloadAdmission) => {
      if (!mounted || own !== attemptGeneration || tool.id !== id || !file || file === dismissedFile || result.file !== file || effectivePreloaded !== file) return;
      if (result.status === 'refused') { recoveryMessage = result.message; return; }
      const token = handover?.file === file ? handover.token : null;
      if (token && !await consumeToken(token)) {
        if (mounted && own === attemptGeneration) recoveryMessage = 'The stored record changed or could not be cleared. Your original remains available.';
        return;
      }
      if (!mounted || own !== attemptGeneration || tool.id !== id || file === dismissedFile || effectivePreloaded !== file) return;
      admittedFile = file;
      recoveryMessage = token || !handover ? '' : 'Imported locally; shared storage remains because no valid token was available.';
    };
  }

  function downloadOriginal() {
    if (!recoveryFile) return;
    const url = URL.createObjectURL(recoveryFile);
    downloadUrls.add(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = recoveryFile.name;
    link.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); downloadTimers.delete(timer); }, 1000);
    downloadTimers.add(timer);
  }

  $: if (tool.id !== priorToolId || preloadedFile !== priorExternalFile) {
    if (preloadedFile !== priorExternalFile && preloadedFile !== dismissedFile) dismissedFile = null;
    priorToolId = tool.id;
    priorExternalFile = preloadedFile;
    attemptGeneration++;
    mountGeneration++;
    chainFile = null;
    admittedFile = null;
    editorMode = 'automatic';
    recoveryMessage = '';
    clearTrail();
  }
  $: variant = VARIANT_MAP[tool.id];
  $: automaticText = variant === 'LiveTextRunner';
  $: activeVariant = automaticText && editorMode === 'manual' ? 'TextInputRunner' : variant;
  $: loader = activeVariant ? variantLoaders[activeVariant] : undefined;
  $: unsupported = typeof loader !== 'function';
  $: runnerPromise = typeof loader === 'function' ? loader().then((m) => m.default) : null;
  $: recoveryFile = handover?.file ?? preloadedFile;
  $: externalEligible = preloadedFile && preloadedFile !== dismissedFile && !unsupported
    && acceptsBrowserFile(tool, preloadedFile)
    && !(automaticText && editorMode === 'automatic' && preloadedFile.size > 1024 * 1024);
  $: effectivePreloaded = chainFile ?? (externalEligible ? preloadedFile : null);
  $: onPreloadAdmission = admissionFor(tool.id, effectivePreloaded, attemptGeneration);
  onDestroy(() => {
    mounted = false;
    attemptGeneration++;
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    for (const timer of downloadTimers) clearTimeout(timer);
    downloadUrls.clear(); downloadTimers.clear();
  });

  // PRO gate -------------------------------------------------------------
  // A PRO tool (cost === 'credit') is loaded into the regular runner only
  // once the user is signed in and has enough credits. Below the gate, the
  // runner mounts normally and the tool's run() is expected to call
  // /api/tools/pro/run internally.
  $: isPro = tool.cost === 'credit';
  $: requiredCredits = (tool.creditCost ?? 1) as number;
  $: gateState = !isPro
    ? 'pass'
    : !$authReady
      ? 'loading'
      : !$user
        ? 'signed-out'
        : ($user.balance ?? 0) < requiredCredits
          ? 'insufficient'
          : 'pass';

  let showBuySheet = false;

  function openAuth() {
    window.dispatchEvent(new Event('wyreup:auth-open'));
  }
</script>

<div class="tool-runner">
  {#if recoveryFile && recoveryFile !== dismissedFile && (recoveryFile !== admittedFile || recoveryMessage)}
    <div class="chain-banner" role="status">
      <div class="chain-banner__body">
        <span class="chain-banner__label">Continue from previous tool</span>
        <span class="chain-banner__file">{recoveryFile.name} — {recoveryFile.size.toLocaleString()} bytes, {recoveryFile.type || 'unknown type'}</span>
        {#if handover?.targetToolId}<span>Intended tool: {String(handover.targetToolId)}</span>{/if}
        {#if recoveryMessage}<p role="status">{recoveryMessage}</p>{/if}
      </div>
      <div class="chain-banner__actions">
        <button class="btn-primary-sm" on:click={acceptChain} type="button">Use this file</button>
        <button class="btn-ghost-sm" on:click={downloadOriginal} type="button">Download original</button>
        <button class="btn-ghost-sm" on:click={acceptChain} type="button">Retry original</button>
        <button class="btn-ghost-sm" on:click={dismissChain} type="button">Dismiss</button>
      </div>
    </div>
  {/if}
  {#if automaticText}
    <div role="group" aria-label="Text editor mode">
      <button type="button" aria-pressed={editorMode === 'automatic'} on:click={() => selectEditorMode('automatic')}>Automatic editor (up to 1 MiB)</button>
      <button type="button" aria-pressed={editorMode === 'manual'} on:click={() => selectEditorMode('manual')}>Manual/file</button>
    </div>
  {/if}
  {#if recoveryMessage && !recoveryFile}<p role="alert">{recoveryMessage}</p>{/if}

  {#if unsupported}
    <div class="runner-error" role="alert">
      This tool does not have a supported runner.
      {#if effectivePreloaded}
        <p>Original file: {effectivePreloaded.name}</p>
      {/if}
    </div>
  {:else if gateState === 'pass'}
    {#await runnerPromise}
      <div class="runner-loading" role="status" aria-live="polite">Loading…</div>
    {:then RunnerComponent}
      {#key mountGeneration}
        <svelte:component this={RunnerComponent} {tool} preloadedFile={effectivePreloaded} {onPreloadAdmission} />
      {/key}
    {:catch error}
      <div class="runner-error" role="alert">
        Failed to load the tool runner: {error.message}. Please refresh the page.
      </div>
    {/await}
  {:else if gateState === 'loading'}
    <div class="runner-loading" role="status" aria-live="polite">Checking access…</div>
  {:else}
    <div class="pro-gate" role="region" aria-label="PRO tool">
      <div class="pro-gate__header">
        <ProBadge cost={requiredCredits} />
        <span class="pro-gate__title">{tool.name}</span>
      </div>
      {#if gateState === 'signed-out'}
        <p class="pro-gate__body">
          This is a PRO tool. Unlock it with your key —
          {requiredCredits} {requiredCredits === 1 ? 'credit' : 'credits'} per run.
          Don't have a key? You can get one in seconds — no credit card needed.
        </p>
        <div class="pro-gate__actions">
          <button type="button" class="pro-gate__primary" on:click={openAuth}>Activate / Get key</button>
        </div>
      {:else}
        <p class="pro-gate__body">
          You have <strong>{$user?.balance ?? 0}</strong> credits — this tool needs
          <strong>{requiredCredits}</strong>.
        </p>
        <div class="pro-gate__actions">
          <button type="button" class="pro-gate__primary" on:click={() => (showBuySheet = true)}>
            Buy credits
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showBuySheet}
  <BuyCreditsSheet on:close={() => (showBuySheet = false)} />
{/if}

<style>
  .tool-runner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Reserves vertical space while the runner variant chunk is fetched.
     Without a minimum height the page would jump when the runner mounts. */
  .runner-loading {
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }

  .runner-error {
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .chain-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--accent-dim);
    border: 1px solid var(--accent-hover);
    border-radius: var(--radius-md);
  }

  .chain-banner__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .chain-banner__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-text);
  }

  .chain-banner__file {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .chain-banner__actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .btn-primary-sm {
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp);
  }

  .btn-primary-sm:hover { background: var(--accent-hover); }
  .btn-primary-sm:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-ghost-sm {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .btn-ghost-sm:hover { color: var(--text-muted); }
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .pro-gate {
    padding: var(--space-5);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .pro-gate__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pro-gate__title {
    font-family: var(--font-sans);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .pro-gate__body {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .pro-gate__actions {
    display: flex;
    gap: var(--space-2);
  }
  .pro-gate__primary {
    height: 32px;
    padding: 0 var(--space-4);
    background: var(--accent);
    color: var(--text-on-accent, #000);
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .pro-gate__primary:hover {
    background: var(--accent-hover);
  }
</style>
