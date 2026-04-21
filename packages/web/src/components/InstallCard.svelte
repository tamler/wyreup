<script lang="ts">
  import { onMount } from 'svelte';

  // beforeinstallprompt event type
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let installState: 'waiting' | 'ready' | 'installed' | 'ios' | 'unsupported' = 'waiting';

  onMount(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      installState = 'installed';
      return;
    }

    // iOS Safari doesn't fire beforeinstallprompt — detect it
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isIos && isSafari) {
      installState = 'ios';
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      installState = 'ready';
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If no prompt fires within 2s on a non-iOS browser, mark unsupported
    const timeout = setTimeout(() => {
      if (installState === 'waiting') {
        installState = 'unsupported';
      }
    }, 2000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timeout);
    };
  });

  async function triggerInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installState = 'installed';
    }
    deferredPrompt = null;
  }
</script>

<div class="anywhere-card brackets install-card">
  <div class="brackets-inner" aria-hidden="true"></div>
  <div class="anywhere-card__inner">
    <div class="anywhere-card__channel">Install as app</div>
    {#if installState === 'installed'}
      <div class="anywhere-card__headline">Installed</div>
      <p class="anywhere-card__body">Wyreup is running as a standalone app on this device.</p>
    {:else if installState === 'ready'}
      <div class="anywhere-card__headline">Add to home screen</div>
      <p class="anywhere-card__body">Install for offline access and file sharing from other apps.</p>
      <button class="install-btn" on:click={triggerInstall}>Install Wyreup</button>
    {:else if installState === 'ios'}
      <div class="anywhere-card__headline">Add to home screen</div>
      <p class="anywhere-card__body">
        Tap the Share button in Safari, then "Add to Home Screen".
      </p>
      <a href="/settings" class="install-link">Settings &rarr;</a>
    {:else if installState === 'unsupported'}
      <div class="anywhere-card__headline">Add to home screen</div>
      <p class="anywhere-card__body">
        Use Chrome or Edge on Android, or Safari on iOS to install.
      </p>
      <a href="/settings" class="install-link">Settings &rarr;</a>
    {:else}
      <div class="anywhere-card__headline">Add to home screen</div>
      <p class="anywhere-card__body">Install for offline access and file sharing from other apps.</p>
    {/if}
  </div>
</div>

<style>
  .install-card {
    display: block;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    text-decoration: none;
    color: inherit;
    transition: border-color var(--duration-fast) var(--ease-sharp);
    position: relative;
    overflow: visible;
  }

  .install-card:hover {
    border-color: var(--text-muted);
  }

  .install-btn {
    margin-top: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--space-2) var(--space-4);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp);
  }

  .install-btn:hover {
    background: var(--accent-hover);
  }

  .install-btn:active {
    transform: scale(0.98);
  }

  .install-link {
    display: inline-block;
    margin-top: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    text-decoration: none;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .install-link:hover {
    color: var(--text-muted);
  }
</style>
