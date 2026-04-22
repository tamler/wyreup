<script lang="ts">
  import { onMount } from 'svelte';

  const DISMISS_KEY = 'wyreup:pwa-onboard-dismissed';

  let visible = false;

  onMount(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone) return;
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed) return;
    visible = true;
  });

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    visible = false;
  }
</script>

{#if visible}
  <div class="pwa-banner" role="banner" aria-label="Welcome onboarding">
    <div class="pwa-banner__inner">
      <p class="pwa-banner__text">
        Welcome to Wyreup. Every tool runs on your device — nothing uploads.
        <a href="/settings" class="pwa-banner__link">Visit Settings</a> to configure which tools cache for offline.
      </p>
      <button class="pwa-banner__dismiss" on:click={dismiss} aria-label="Dismiss welcome message">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .pwa-banner {
    border-bottom: 1px solid var(--accent);
    background: var(--accent-dim);
    padding: var(--space-3) 0;
  }

  .pwa-banner__inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 var(--space-6);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .pwa-banner__text {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .pwa-banner__link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .pwa-banner__link:hover {
    color: var(--accent-hover);
  }

  .pwa-banner__dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: var(--space-1);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .pwa-banner__dismiss:hover {
    color: var(--text-primary);
  }
</style>
