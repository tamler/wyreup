<script lang="ts">
  import { onMount } from 'svelte';
  import type { ComponentType } from 'svelte';
  import type { SerializedTool } from './runners/types';
  import { VARIANT_MAP, type RunnerVariant } from './runners/variantMap';
  import { clearChainFile, consumeChainFile, peekChainFile } from './runners/chainStorage';
  import { clearTrail } from './runners/hopTrail';
  import { user, authReady } from '../stores/user';
  import ProBadge from './ProBadge.svelte';
  import BuyCreditsSheet from './BuyCreditsSheet.svelte';

  // Dynamic-import map: each runner becomes its own Vite chunk, fetched only
  // when the matching tool page mounts. Saves ~150KB on the initial ToolRunner
  // bundle (29 variants × ~5-15KB each after gzip and hoisted shared deps).
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
  };

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  let chainFile: File | null = null;
  let chainBanner = false;
  let chainMeta: { name: string; type: string } | null = null;

  onMount(async () => {
    const peeked = await peekChainFile();
    if (!peeked) {
      clearTrail();
      return;
    }
    if (peeked.autoAccept) {
      // User already chose this file (e.g. via /tools drop-to-filter) — load
      // it without an extra confirmation step.
      chainFile = await consumeChainFile();
      return;
    }
    chainMeta = peeked;
    chainBanner = true;
  });

  async function acceptChain() {
    chainFile = await consumeChainFile();
    chainBanner = false;
  }

  async function dismissChain() {
    await clearChainFile();
    chainBanner = false;
  }

  $: variant = VARIANT_MAP[tool.id] ?? 'SimpleImageRunner';
  $: runnerPromise = variantLoaders[variant]().then((m) => m.default);
  $: effectivePreloaded = chainFile ?? preloadedFile;

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
  {#if chainBanner && chainMeta}
    <div class="chain-banner" role="status">
      <div class="chain-banner__body">
        <span class="chain-banner__label">Continue from previous tool</span>
        <span class="chain-banner__file">{chainMeta.name}</span>
      </div>
      <div class="chain-banner__actions">
        <button class="btn-primary-sm" on:click={acceptChain} type="button">Use this file</button>
        <button class="btn-ghost-sm" on:click={dismissChain} type="button">Dismiss</button>
      </div>
    </div>
  {/if}

  {#if gateState === 'pass'}
    {#await runnerPromise}
      <div class="runner-loading" role="status" aria-live="polite">Loading…</div>
    {:then RunnerComponent}
      <svelte:component this={RunnerComponent} {tool} preloadedFile={effectivePreloaded} />
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
          This is a PRO tool. Activate your API key to use it
          ({requiredCredits} credits per run).
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
