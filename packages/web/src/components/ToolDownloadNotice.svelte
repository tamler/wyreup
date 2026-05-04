<script lang="ts">
  import { onMount } from 'svelte';

  // First-use download notice for ML/heavy tools. Hides itself after the
  // user has run the tool at least once locally (tracked in localStorage)
  // so it doesn't nag on every revisit. The actual SW disk cache survives
  // independently — this is purely a UX hint for the first run.

  export let toolId: string;
  export let installSize: number | undefined = undefined;
  export let installGroup: string | undefined = undefined;

  let dismissed = false;
  let alreadyUsed = false;

  const STORAGE_KEY = 'wyreup:tools-used';

  function readUsed(): Record<string, true> {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, true>) : {};
    } catch {
      return {};
    }
  }

  onMount(() => {
    const used = readUsed();
    alreadyUsed = used[toolId] === true;
  });

  function dismiss() {
    dismissed = true;
  }

  function format(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${Math.round(mb * 1024)} KB`;
    if (mb < 1024) return `${Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  $: visible =
    !dismissed && !alreadyUsed && typeof installSize === 'number' && installSize > 0;
  $: sizeStr = installSize ? format(installSize) : '';
</script>

{#if visible}
  <div class="dl-notice" role="status">
    <span class="dl-notice__icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </span>
    <div class="dl-notice__body">
      <strong>First run downloads ~{sizeStr}.</strong>
      <span>
        The model is cached after the first use, then runs offline.
        {#if installGroup}
          Manage downloads on the
          <a href="/settings" class="dl-notice__link">settings page</a>.
        {/if}
      </span>
    </div>
    <button class="dl-notice__close" on:click={dismiss} aria-label="Dismiss download notice" type="button">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>
{/if}

<style>
  .dl-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-hover);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .dl-notice__icon {
    color: var(--accent-text);
    flex-shrink: 0;
    margin-top: 1px;
  }

  .dl-notice__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
    line-height: 1.4;
  }

  .dl-notice__body strong {
    font-weight: 600;
  }

  .dl-notice__body span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .dl-notice__link {
    color: var(--accent-text);
    text-decoration: underline;
  }

  .dl-notice__link:hover {
    color: var(--accent-hover);
  }

  .dl-notice__close {
    background: none;
    border: none;
    color: var(--text-subtle);
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    line-height: 0;
    border-radius: var(--radius-sm);
    transition: color var(--duration-instant) var(--ease-sharp), background var(--duration-instant) var(--ease-sharp);
  }

  .dl-notice__close:hover {
    color: var(--text-primary);
    background: var(--bg-raised);
  }

  .dl-notice__close:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }
</style>
