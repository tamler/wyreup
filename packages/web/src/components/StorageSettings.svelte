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
  let modelsClearedMsg = '';
  let modelsClearError = '';

  interface CachedModel {
    id: string;
    bytes: number;
    requestCount: number;
  }
  let cachedModels: CachedModel[] = [];
  let modelsLoading = false;
  let perModelDeleting: Record<string, boolean> = {};

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
    void refreshModelList();
  }

  /**
   * Group every cached HuggingFace request by `<org>/<repo>` and sum
   * bytes via Content-Length headers. Other CDN entries (jsdelivr,
   * googleapis) aren't model-attributable in the same way; they're
   * left to the global Clear button.
   */
  async function refreshModelList(): Promise<void> {
    if (typeof caches === 'undefined') {
      cachedModels = [];
      return;
    }
    modelsLoading = true;
    try {
      const cache = await caches.open('wyreup-cdn-assets').catch(() => null);
      if (!cache) {
        cachedModels = [];
        return;
      }
      const requests = await cache.keys();
      const groups = new Map<string, CachedModel>();

      for (const req of requests) {
        const url = new URL(req.url);
        if (url.hostname !== 'huggingface.co') continue;
        // Path: /<org>/<repo>/resolve/<ref>/<file>
        const m = /^\/([^/]+)\/([^/]+)\/resolve\//.exec(url.pathname);
        if (!m) continue;
        const id = `${m[1]}/${m[2]}`;
        let group = groups.get(id);
        if (!group) {
          group = { id, bytes: 0, requestCount: 0 };
          groups.set(id, group);
        }
        group.requestCount += 1;
        const resp = await cache.match(req);
        const cl = resp?.headers.get('content-length');
        if (cl) group.bytes += parseInt(cl, 10);
      }

      cachedModels = Array.from(groups.values()).sort((a, b) => b.bytes - a.bytes);
    } catch {
      cachedModels = [];
    } finally {
      modelsLoading = false;
    }
  }

  async function deleteOneModel(id: string): Promise<void> {
    perModelDeleting = { ...perModelDeleting, [id]: true };
    try {
      const cache = await caches.open('wyreup-cdn-assets');
      const requests = await cache.keys();
      const toDelete: Request[] = [];
      for (const req of requests) {
        const url = new URL(req.url);
        if (url.hostname !== 'huggingface.co') continue;
        const m = /^\/([^/]+)\/([^/]+)\/resolve\//.exec(url.pathname);
        if (m && `${m[1]}/${m[2]}` === id) toDelete.push(req);
      }
      await Promise.all(toDelete.map((r) => cache.delete(r)));
      // Also drop the in-memory pipeline that loaded these weights so a
      // subsequent run truly hits disk (which is now empty for them).
      const { clearPipelineCache } = await import('@wyreup/core');
      clearPipelineCache();
      broadcastChange();
    } finally {
      perModelDeleting = { ...perModelDeleting, [id]: false };
    }
  }

  onMount(() => {
    void refresh();
    // Re-evaluate when another part of the UI clears storage (or when the
    // window regains focus, which catches OS-level cache eviction).
    const onSync = () => { void refresh(); };
    window.addEventListener('wyreup:storage-changed', onSync);
    window.addEventListener('focus', onSync);
    return () => {
      window.removeEventListener('wyreup:storage-changed', onSync);
      window.removeEventListener('focus', onSync);
    };
  });

  function broadcastChange() {
    window.dispatchEvent(new CustomEvent('wyreup:storage-changed'));
  }

  async function freeMemory() {
    memoryClearing = true;
    memoryCleared = false;
    try {
      const { clearPipelineCache } = await import('@wyreup/core');
      clearPipelineCache();
      memoryCleared = true;
      broadcastChange();
      setTimeout(() => { memoryCleared = false; }, 2500);
    } catch {
      /* ignore */
    } finally {
      memoryClearing = false;
    }
  }

  async function clearModels() {
    if (
      typeof confirm === 'function' &&
      !confirm('Clear all cached AI models? They will re-download on next use.')
    ) {
      return;
    }
    modelsClearing = true;
    modelsCleared = false;
    modelsClearedMsg = '';
    modelsClearError = '';
    const before = usageMb;
    try {
      // Three caches that may hold model bytes:
      //   wyreup-cdn-assets    — HuggingFace / jsdelivr / googleapis
      //                          (this is where transformers.js model
      //                          weights actually live)
      //   wyreup-heavy-assets  — same-origin .wasm / .onnx
      //   transformers-cache   — upstream transformers.js fallback name
      const targets = ['wyreup-cdn-assets', 'wyreup-heavy-assets', 'transformers-cache'];
      const results = await Promise.all(
        targets.map((name) => caches.delete(name).catch(() => false)),
      );
      const cachesCleared = results.filter(Boolean).length;
      const { clearPipelineCache } = await import('@wyreup/core');
      clearPipelineCache();
      await refresh();
      const freedMb = Math.max(0, Math.round((before - usageMb) * 10) / 10);
      broadcastChange();
      modelsCleared = true;
      if (cachesCleared === 0 && freedMb === 0) {
        modelsClearedMsg = 'Already empty — nothing cached.';
      } else if (freedMb > 0) {
        modelsClearedMsg = `Cleared ${cachesCleared} cache${cachesCleared === 1 ? '' : 's'} — freed ${formatBytes(freedMb)}.`;
      } else {
        modelsClearedMsg = `Cleared ${cachesCleared} cache${cachesCleared === 1 ? '' : 's'}.`;
      }
      setTimeout(() => { modelsCleared = false; modelsClearedMsg = ''; }, 4000);
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

    {#if cachedModels.length > 0}
      <div class="model-list" aria-label="Cached AI models">
        <div class="model-list__header">
          <span>{cachedModels.length} model{cachedModels.length === 1 ? '' : 's'} cached</span>
          <span>{formatBytes(cachedModels.reduce((acc, m) => acc + m.bytes, 0) / (1024 * 1024))} total</span>
        </div>
        {#each cachedModels as m}
          <div class="model-row">
            <div class="model-row__info">
              <span class="model-row__id">{m.id}</span>
              <span class="model-row__meta">{formatBytes(m.bytes / (1024 * 1024))} · {m.requestCount} file{m.requestCount === 1 ? '' : 's'}</span>
            </div>
            <button
              class="btn-secondary btn-secondary--danger model-row__delete"
              on:click={() => deleteOneModel(m.id)}
              disabled={perModelDeleting[m.id]}
              type="button"
              aria-label={`Delete ${m.id} from disk`}
            >
              {perModelDeleting[m.id] ? '…' : 'Delete'}
            </button>
          </div>
        {/each}
      </div>
    {:else if !modelsLoading}
      <p class="storage-msg storage-msg--muted">No AI models cached yet. Models download the first time you use a tool that needs them.</p>
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

    {#if modelsClearedMsg}
      <p class="storage-msg storage-msg--ok" role="status">{modelsClearedMsg}</p>
    {/if}
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

  .storage-msg--ok {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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

  .model-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
    padding: var(--space-2);
  }

  .model-list__header {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .model-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
  }

  .model-row__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .model-row__id {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-row__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .model-row__delete {
    height: 28px;
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    flex-shrink: 0;
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
