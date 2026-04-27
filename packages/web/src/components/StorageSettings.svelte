<script lang="ts">
  import { onMount } from 'svelte';

  // /settings storage panel. Three affordances:
  //
  //   1. Show how much disk Wyreup is using (and the browser's quota).
  //   2. "Free up memory" — drop in-memory ML pipelines without
  //      touching disk. Models stay cached; next use re-instantiates
  //      from disk in seconds, not a re-download.
  //   3. "Clear cached models" — delete the SW `wyreup-heavy-assets`
  //      cache. Forces a re-download of any ML model on next use.
  //      Useful when reclaiming significant disk space.

  type Status = 'unknown' | 'ready' | 'unsupported';
  let status: Status = 'unknown';
  let usageMb = 0;
  let quotaMb = 0;
  let persisted: boolean | null = null;
  let memoryClearing = false;
  let memoryCleared = false;
  let modelsClearing = false;
  let modelsCleared = false;
  let modelsClearError = '';

  async function refresh() {
    if (typeof navigator === 'undefined' || !('storage' in navigator)) {
      status = 'unsupported';
      return;
    }
    try {
      const est = await navigator.storage.estimate();
      usageMb = Math.round(((est.usage ?? 0) / (1024 * 1024)) * 10) / 10;
      quotaMb = Math.round(((est.quota ?? 0) / (1024 * 1024)) * 10) / 10;
      if (typeof navigator.storage.persisted === 'function') {
        persisted = await navigator.storage.persisted();
      }
      status = 'ready';
    } catch {
      status = 'unsupported';
    }
  }

  onMount(() => {
    void refresh();
  });

  async function freeMemory() {
    memoryClearing = true;
    memoryCleared = false;
    try {
      const { clearPipelineCache } = await import('@wyreup/core');
      clearPipelineCache();
      memoryCleared = true;
      setTimeout(() => { memoryCleared = false; }, 2500);
    } catch {
      /* ignore */
    } finally {
      memoryClearing = false;
    }
  }

  async function clearModels() {
    if (!confirm('Clear all cached AI models? They will re-download on next use.')) return;
    modelsClearing = true;
    modelsCleared = false;
    modelsClearError = '';
    try {
      // The SW's cacheFirst handler stores heavy assets under this name.
      const ok = await caches.delete('wyreup-heavy-assets');
      if (!ok) {
        // Cache may not exist yet (no models downloaded). Treat as success.
      }
      // Also drop the in-memory pipelines so the next use truly hits disk
      // (which is now empty for these URLs).
      const { clearPipelineCache } = await import('@wyreup/core');
      clearPipelineCache();
      modelsCleared = true;
      await refresh();
      setTimeout(() => { modelsCleared = false; }, 2500);
    } catch (err) {
      modelsClearError = err instanceof Error ? err.message : String(err);
    } finally {
      modelsClearing = false;
    }
  }

  function formatBytes(mb: number): string {
    if (mb < 1) return `${Math.round(mb * 1024)} KB`;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }
</script>

<section class="storage-panel" aria-labelledby="storage-heading">
  <h2 id="storage-heading" class="storage-heading">Storage</h2>

  {#if status === 'unsupported'}
    <p class="storage-msg">Your browser doesn't expose storage estimates. Cached models still work — you just can't see usage from here.</p>
  {:else if status === 'unknown'}
    <p class="storage-msg storage-msg--muted">Checking…</p>
  {:else}
    <dl class="storage-stats">
      <div class="storage-stat">
        <dt>Used</dt>
        <dd>{formatBytes(usageMb)}</dd>
      </div>
      <div class="storage-stat">
        <dt>Quota</dt>
        <dd>{formatBytes(quotaMb)}</dd>
      </div>
      <div class="storage-stat">
        <dt>Persistent</dt>
        <dd>{persisted === null ? '—' : persisted ? 'yes' : 'best-effort'}</dd>
      </div>
    </dl>

    {#if persisted === false}
      <p class="storage-warn">
        Your browser may evict cached models under storage pressure (or after
        ~7 days of inactivity on iOS). Install Wyreup as a PWA to upgrade
        to persistent storage automatically.
      </p>
    {/if}

    <div class="storage-actions">
      <div class="storage-action">
        <div class="storage-action__copy">
          <strong>Free up memory</strong>
          <span>Drop AI models from RAM. Disk cache untouched — next use is a quick reload.</span>
        </div>
        <button class="btn-secondary" on:click={freeMemory} disabled={memoryClearing} type="button">
          {memoryCleared ? 'Done' : memoryClearing ? '…' : 'Free up'}
        </button>
      </div>
      <div class="storage-action">
        <div class="storage-action__copy">
          <strong>Clear cached models</strong>
          <span>Delete model weights from disk. Frees the most space; next use re-downloads.</span>
        </div>
        <button class="btn-secondary btn-secondary--danger" on:click={clearModels} disabled={modelsClearing} type="button">
          {modelsCleared ? 'Cleared' : modelsClearing ? '…' : 'Clear'}
        </button>
      </div>
    </div>

    {#if modelsClearError}
      <p class="storage-error" role="alert">{modelsClearError}</p>
    {/if}
  {/if}
</section>

<style>
  .storage-panel {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-8);
  }

  .storage-heading {
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .storage-msg {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }

  .storage-msg--muted {
    color: var(--text-subtle);
  }

  .storage-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    margin: 0;
  }

  .storage-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .storage-stat dt {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .storage-stat dd {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    margin: 0;
  }

  .storage-warn {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
    padding: var(--space-2) var(--space-3);
    border-left: 2px solid var(--accent);
    background: var(--bg-raised);
    margin: 0;
  }

  .storage-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .storage-action {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .storage-action__copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .storage-action__copy strong {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .storage-action__copy span {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    line-height: 1.4;
  }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-elevated);
    border-color: var(--text-muted);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .btn-secondary--danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  }

  .btn-secondary--danger:hover:not(:disabled) {
    border-color: var(--danger);
  }

  .storage-error {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--danger);
    margin: 0;
  }
</style>
