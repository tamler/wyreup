<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // Three lifecycle concerns bundled in one always-mounted component:
  //
  //   1. Request `navigator.storage.persist()` once. Promotes our SW
  //      cache + IndexedDB from "best-effort" to "persistent" so iOS's
  //      7-day inactivity rule and Chrome/Firefox storage pressure
  //      don't silently evict cached ML models.
  //   2. Show a "Wyreup updated — refresh?" toast when the service
  //      worker activates a new version. Without it the user sees
  //      stale content until next page load.
  //   3. Show an offline indicator when `navigator.onLine === false`,
  //      so users understand why an ML tool's first-time download
  //      isn't working.

  let updateAvailable = false;
  let isOffline = false;

  // Skip the toast for the *very first* SW activation (initial install).
  // Only show it for subsequent updates.
  let initialControllerSeen = false;

  async function tryPersist() {
    try {
      if (!('storage' in navigator) || !navigator.storage.persist) return;
      const already = await navigator.storage.persisted?.();
      if (already) return;
      await navigator.storage.persist();
    } catch {
      /* ignore — best-effort */
    }
  }

  function refresh() {
    window.location.reload();
  }

  function dismissUpdate() {
    updateAvailable = false;
  }

  let controllerHandler: (() => void) | null = null;
  let onlineHandler: (() => void) | null = null;
  let offlineHandler: (() => void) | null = null;

  onMount(() => {
    isOffline = !navigator.onLine;
    onlineHandler = () => { isOffline = false; };
    offlineHandler = () => { isOffline = true; };
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);

    void tryPersist();

    if ('serviceWorker' in navigator) {
      initialControllerSeen = navigator.serviceWorker.controller !== null;
      controllerHandler = () => {
        if (!initialControllerSeen) {
          // First activation — don't toast, just record.
          initialControllerSeen = true;
          return;
        }
        // A new SW took over. Tell the user.
        updateAvailable = true;
      };
      navigator.serviceWorker.addEventListener('controllerchange', controllerHandler);
    }
  });

  onDestroy(() => {
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
    if (offlineHandler) window.removeEventListener('offline', offlineHandler);
    if (controllerHandler && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', controllerHandler);
    }
  });
</script>

{#if isOffline}
  <div class="pwa-banner pwa-banner--offline" role="status" aria-live="polite">
    <span class="pwa-banner__dot pwa-banner__dot--offline" aria-hidden="true"></span>
    <span class="pwa-banner__msg">Offline. Cached tools still work; ML tools need internet on first use.</span>
  </div>
{/if}

{#if updateAvailable}
  <div class="pwa-toast" role="status" aria-live="polite">
    <span class="pwa-toast__msg">A new version of Wyreup is available.</span>
    <div class="pwa-toast__actions">
      <button class="pwa-toast__btn pwa-toast__btn--primary" on:click={refresh} type="button">Refresh</button>
      <button class="pwa-toast__btn" on:click={dismissUpdate} type="button" aria-label="Dismiss update notification">Later</button>
    </div>
  </div>
{/if}

<style>
  .pwa-banner {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .pwa-banner__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .pwa-banner__dot--offline {
    background: var(--text-subtle);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-subtle) 30%, transparent);
  }

  .pwa-banner__msg {
    line-height: 1.4;
  }

  .pwa-toast {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--accent-hover);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    max-width: 320px;
    animation: pwa-toast-in 200ms ease-out;
  }

  @keyframes pwa-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .pwa-toast__msg {
    line-height: 1.4;
  }

  .pwa-toast__actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .pwa-toast__btn {
    height: 28px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: color var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }

  .pwa-toast__btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .pwa-toast__btn--primary {
    background: var(--accent);
    color: var(--black);
    border-color: var(--accent-hover);
  }

  .pwa-toast__btn--primary:hover {
    background: var(--accent-hover);
    color: var(--black);
  }

  .pwa-toast__btn:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .pwa-toast {
      animation: none;
    }
  }
</style>
