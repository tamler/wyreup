<script lang="ts">
  import { onMount } from 'svelte';
  import type { SerializedTool } from './runners/types';
  import { VARIANT_MAP } from './runners/variantMap';
  import { clearChainFile, consumeChainFile, peekChainFile } from './runners/chainStorage';

  import SimpleImageRunner from './runners/SimpleImageRunner.svelte';
  import PreviewRunner from './runners/PreviewRunner.svelte';
  import MultiInputRunner from './runners/MultiInputRunner.svelte';
  import MultiOutputRunner from './runners/MultiOutputRunner.svelte';
  import JsonResultRunner from './runners/JsonResultRunner.svelte';
  import TextResultRunner from './runners/TextResultRunner.svelte';
  import TextInputRunner from './runners/TextInputRunner.svelte';
  import TwoTextInputRunner from './runners/TwoTextInputRunner.svelte';
  import GenerateRunner from './runners/GenerateRunner.svelte';
  import CompoundInterestRunner from './runners/CompoundInterestRunner.svelte';
  import InvestmentDcaRunner from './runners/InvestmentDcaRunner.svelte';
  import PercentageCalculatorRunner from './runners/PercentageCalculatorRunner.svelte';
  import DateCalculatorRunner from './runners/DateCalculatorRunner.svelte';
  import PdfRedactRunner from './runners/PdfRedactRunner.svelte';
  import RecordAudioRunner from './runners/RecordAudioRunner.svelte';

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  let chainFile: File | null = null;
  let chainBanner = false;
  let chainMeta: { name: string; type: string } | null = null;

  onMount(async () => {
    const peeked = await peekChainFile();
    if (!peeked) return;
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

  const variantComponents = {
    SimpleImageRunner,
    PreviewRunner,
    MultiInputRunner,
    MultiOutputRunner,
    JsonResultRunner,
    TextResultRunner,
    TextInputRunner,
    TwoTextInputRunner,
    GenerateRunner,
    CompoundInterestRunner,
    InvestmentDcaRunner,
    PercentageCalculatorRunner,
    DateCalculatorRunner,
    PdfRedactRunner,
    RecordAudioRunner,
  } as const;

  $: variant = VARIANT_MAP[tool.id] ?? 'SimpleImageRunner';
  $: RunnerComponent = variantComponents[variant];
  $: effectivePreloaded = chainFile ?? preloadedFile;
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

  <svelte:component this={RunnerComponent} {tool} preloadedFile={effectivePreloaded} />
</div>

<style>
  .tool-runner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .chain-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--accent-dim);
    border: 1px solid var(--accent);
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
    color: var(--accent);
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
  .btn-primary-sm:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
