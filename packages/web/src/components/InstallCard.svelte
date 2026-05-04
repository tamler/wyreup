<script lang="ts">
  import { onMount } from 'svelte';

  // beforeinstallprompt event type
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let installState: 'waiting' | 'ready' | 'installed' | 'ios' | 'chromium-manual' | 'desktop-safari' | 'firefox' = 'waiting';

  onMount(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      installState = 'installed';
      return;
    }

    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isChromium = /chrome|chromium|edg|opr|brave/i.test(ua) && !/edge\//i.test(ua);
    const isFirefox = /firefox/i.test(ua);

    // iOS Safari: manual Add to Home Screen via Share sheet
    if (isIos && isSafari) {
      installState = 'ios';
      return;
    }

    // Desktop Safari (macOS Sonoma+) can install via File → Add to Dock
    if (!isIos && isSafari) {
      installState = 'desktop-safari';
      return;
    }

    // Firefox doesn't support PWA install on desktop
    if (isFirefox) {
      installState = 'firefox';
      return;
    }

    // Chromium family — listen for the install prompt; if it doesn't fire
    // (common when prompt fired in a prior session, or criteria aren't met
    // yet), fall through to manual instructions instead of "unsupported".
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      installState = 'ready';
    };

    window.addEventListener('beforeinstallprompt', handler);

    // After 2.5s, if still waiting and we detected a Chromium browser,
    // show manual instructions. Chromium always supports PWA install —
    // the event just may not fire on repeat visits.
    const timeout = setTimeout(() => {
      if (installState === 'waiting') {
        installState = isChromium ? 'chromium-manual' : 'chromium-manual';
      }
    }, 2500);

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
      <div class="anywhere-card__headline install-installed">
        <span class="check-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        Installed on this device
      </div>
      <p class="anywhere-card__body">Wyreup is running as a standalone app.</p>
      <a href="/settings" class="install-link">Configure tools &rarr;</a>
    {:else if installState === 'ready'}
      <div class="anywhere-card__headline">Add to home screen</div>
      <button class="install-btn" on:click={triggerInstall}>Install Wyreup</button>
      <ul class="install-benefits">
        <li>Works offline</li>
        <li>Share files from any app to Wyreup (mobile)</li>
        <li>Register as a handler for images, PDFs, audio (desktop)</li>
      </ul>
    {:else if installState === 'ios'}
      <div class="anywhere-card__headline">Add to home screen</div>
      <p class="anywhere-card__body">
        In Safari, tap the Share icon at the bottom of the screen, then "Add to Home Screen."
      </p>
      <a href="/settings" class="install-link">Settings &rarr;</a>
    {:else if installState === 'chromium-manual'}
      <div class="anywhere-card__headline">Install from your browser</div>
      <p class="anywhere-card__body">
        Click the install icon in the address bar, or open the browser menu and pick <strong>Install Wyreup</strong>.
      </p>
      <ul class="install-benefits">
        <li>Works offline</li>
        <li>Share files from any app to Wyreup (mobile)</li>
        <li>Register as a handler for images, PDFs, audio</li>
      </ul>
    {:else if installState === 'desktop-safari'}
      <div class="anywhere-card__headline">Install via the File menu</div>
      <p class="anywhere-card__body">
        In Safari (macOS Sonoma or later), open the <strong>File</strong> menu and choose <strong>Add to Dock</strong>.
      </p>
    {:else if installState === 'firefox'}
      <div class="anywhere-card__headline">Install from another browser</div>
      <p class="anywhere-card__body">
        Firefox on desktop doesn't support PWA installation. Open Wyreup in
        <a href="https://www.google.com/chrome/" target="_blank" rel="noopener noreferrer" class="install-browser-link">Chrome</a>,
        <a href="https://www.microsoft.com/edge" target="_blank" rel="noopener noreferrer" class="install-browser-link">Edge</a>,
        or Safari 17+ to install as an app.
      </p>
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

  .install-installed {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .check-icon {
    color: #4ade80;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .install-btn {
    margin-top: var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--space-2) var(--space-4);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp);
    display: block;
  }

  .install-btn:hover {
    background: var(--accent-hover);
  }

  .install-btn:active {
    transform: scale(0.98);
  }

  .install-benefits {
    margin-top: var(--space-3);
    padding-left: var(--space-4);
    list-style: disc;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    line-height: 1.6;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .install-link {
    display: inline-block;
    margin-top: var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    text-decoration: none;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .install-link:hover {
    color: var(--text-muted);
  }

  .install-browser-link {
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .install-browser-link:hover {
    color: var(--text-primary);
  }
</style>
