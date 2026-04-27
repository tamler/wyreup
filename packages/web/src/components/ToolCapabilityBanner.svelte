<script lang="ts">
  import { capabilities } from '../stores/capabilities';
  import { checkToolCapabilities, type ToolRequires } from '@wyreup/core';

  // Per-tool capability notice. Shown above the runner when the device
  // can't run this tool. Direct URLs always render the page (so chain
  // navigation doesn't break) — this component is the explanation.

  export let requires: ToolRequires | undefined = undefined;
  export let toolName: string;

  $: check =
    $capabilities.ready && requires
      ? checkToolCapabilities({ requires }, $capabilities.caps)
      : null;
  $: showBlock = check && !check.runnable;
  $: showSlow = check && check.runnable && check.slower;
</script>

{#if showBlock}
  <div class="cap-banner cap-banner--block" role="alert">
    <span class="cap-banner__icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </span>
    <div class="cap-banner__body">
      <strong>This device can't run {toolName}.</strong>
      <span>{check?.reason ?? 'Capability requirements not met.'}</span>
      <span class="cap-banner__hint">
        You can still queue this tool as a chain step — open the chain on a
        device that supports it.
      </span>
    </div>
  </div>
{:else if showSlow}
  <div class="cap-banner cap-banner--slow" role="status">
    <span class="cap-banner__icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </span>
    <div class="cap-banner__body">
      <strong>{toolName} will be slower on this device.</strong>
      <span>WebGPU isn't available — falling back to CPU.</span>
    </div>
  </div>
{/if}

<style>
  .cap-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .cap-banner--block {
    background: var(--bg-elevated);
    border: 1px solid var(--danger);
    color: var(--text-primary);
  }

  .cap-banner--slow {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .cap-banner__icon {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .cap-banner--block .cap-banner__icon {
    color: var(--danger);
  }

  .cap-banner--slow .cap-banner__icon {
    color: var(--text-subtle);
  }

  .cap-banner__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cap-banner__body strong {
    font-weight: 600;
  }

  .cap-banner__hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-top: var(--space-1);
  }
</style>
