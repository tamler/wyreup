<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { observePwaUpdate, shouldShowPwaUpdate, type PwaUpdateStatus } from '../lib/pwaUpdate';

  let status: PwaUpdateStatus | null = null;
  let dismissedWorker: ServiceWorker | null = null;
  let showCheckStatus = false;
  let isOffline = false;
  let observer: ReturnType<typeof observePwaUpdate> | null = null;

  $: updateAvailable = shouldShowPwaUpdate(status, dismissedWorker);

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

  function dismissUpdate() {
    if (status?.kind === 'waiting') dismissedWorker = status.worker;
    showCheckStatus = false;
  }

  function check() {
    showCheckStatus = true;
    void observer?.check();
  }

  let onlineHandler: (() => void) | null = null;
  let offlineHandler: (() => void) | null = null;

  onMount(() => {
    isOffline = !navigator.onLine;
    onlineHandler = () => { isOffline = false; };
    offlineHandler = () => { isOffline = true; };
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    void tryPersist();
    observer = observePwaUpdate((value) => { status = value; });
  });

  onDestroy(() => {
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
    if (offlineHandler) window.removeEventListener('offline', offlineHandler);
    observer?.dispose();
  });
</script>

{#if isOffline}
  <div class="pwa-banner pwa-banner--offline" role="status" aria-live="polite">
    <span class="pwa-banner__dot pwa-banner__dot--offline" aria-hidden="true"></span>
    <span class="pwa-banner__msg">Offline. Local tools can work when their required assets are available. Network lookups and hosted PRO tools need a connection; some local tools download assets on first use.</span>
  </div>
{/if}

{#if updateAvailable || showCheckStatus}
  <div class="pwa-toast" role="status" aria-live="polite">
    <span class="pwa-toast__msg">{status?.message}</span>
    <div class="pwa-toast__actions">
      <button class="pwa-toast__btn pwa-toast__btn--primary" on:click={check} disabled={status?.checking} type="button">Check for update</button>
      <button class="pwa-toast__btn" on:click={dismissUpdate} type="button" aria-label="Dismiss update notification">Later</button>
      <a class="pwa-toast__btn" href="/app-update/" target="_blank" rel="noopener">Update instructions</a>
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
    flex-wrap: wrap;
  }

  .pwa-toast__btn {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
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
