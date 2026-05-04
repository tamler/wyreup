<script lang="ts">
  import { onMount } from 'svelte';

  // Two distinct dismiss keys so dismissing one banner state doesn't
  // dismiss the other. A user might tap "got it" on the iOS install
  // hint, install the app, and *then* see the post-install welcome
  // — we want both.
  const WELCOME_DISMISS_KEY = 'wyreup:pwa-onboard-dismissed';
  const IOS_INSTALL_DISMISS_KEY = 'wyreup:pwa-ios-install-dismissed';

  type Mode = 'welcome' | 'ios-install-hint' | null;
  let mode: Mode = null;

  onMount(() => {
    // Display-mode covers Chromium / Edge / Firefox PWA installs.
    // navigator.standalone is the iOS-specific signal (set when the
    // page is launched from a home-screen icon).
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      if (localStorage.getItem(WELCOME_DISMISS_KEY)) return;
      mode = 'welcome';
      return;
    }

    // iOS Safari (and any iOS browser, since they're all WebKit-backed)
    // can install via Share → Add to Home Screen. Safari doesn't fire
    // `beforeinstallprompt`, so users who don't already know about the
    // gesture won't discover it without an explicit hint.
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);

    if (isIos) {
      if (localStorage.getItem(IOS_INSTALL_DISMISS_KEY)) return;
      mode = 'ios-install-hint';
    }
  });

  function dismissWelcome() {
    localStorage.setItem(WELCOME_DISMISS_KEY, '1');
    mode = null;
  }

  function dismissIosHint() {
    localStorage.setItem(IOS_INSTALL_DISMISS_KEY, '1');
    mode = null;
  }
</script>

{#if mode === 'welcome'}
  <div class="pwa-banner" role="banner" aria-label="Welcome onboarding">
    <div class="pwa-banner__inner">
      <p class="pwa-banner__text">
        Welcome to Wyreup. Every tool runs on your device — nothing uploads.
        <a href="/settings" class="pwa-banner__link">Visit Settings</a> to configure which tools cache for offline.
      </p>
      <button class="pwa-banner__dismiss" on:click={dismissWelcome} aria-label="Dismiss welcome message">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
{:else if mode === 'ios-install-hint'}
  <div class="pwa-banner" role="banner" aria-label="Install Wyreup on iOS">
    <div class="pwa-banner__inner">
      <p class="pwa-banner__text">
        Install Wyreup on your home screen — tap the
        <span class="pwa-banner__icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </span>
        Share button in Safari, then choose <strong>Add to Home Screen</strong>. Works fully offline once installed.
      </p>
      <button class="pwa-banner__dismiss" on:click={dismissIosHint} aria-label="Dismiss install hint">
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
    border-bottom: 1px solid var(--accent-hover);
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
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .pwa-banner__link:hover {
    color: var(--accent-hover);
  }

  .pwa-banner__icon {
    display: inline-flex;
    align-items: center;
    color: var(--accent-text);
    transform: translateY(2px);
    margin: 0 1px;
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
