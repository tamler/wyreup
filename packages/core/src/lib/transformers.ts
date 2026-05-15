/**
 * Transformers.js v4 pipeline singleton loader.
 *
 * Cache is module-level so pipelines survive multiple tool invocations within
 * the same JS module instance (i.e. the same browser tab or Node process).
 * ctx.cache is per-invocation; pipeline loading is expensive (downloads model
 * weights on first use), so we cache across invocations here.
 *
 * **Memory discipline.** Pipelines are heavy — 30 MB to 400 MB of model
 * weights resident in the JS heap, plus ONNX runtime sessions. We bound
 * the cache:
 *
 *  1. LRU cap (`MAX_PIPELINES`) — at most this many models stay in the
 *     heap at once. Evicting is cheap because the SW disk-caches the
 *     weight files (`wyreup-heavy-assets`), so a re-load is a few-second
 *     WASM-instantiate, not a re-download.
 *  2. Visibility-based eviction — when the tab is hidden for
 *     `IDLE_EVICT_MS` we drop the cache entirely. Especially important
 *     for PWA users whose process is more likely to be killed under
 *     memory pressure.
 */
import type { ToolRunContext } from '../types.js';
import { getModelCdn } from './model-cdn.js';

const MAX_PIPELINES = 2;
const IDLE_EVICT_MS = 5 * 60 * 1000;

const pipelineCache: Map<string, unknown> = new Map();

/** Best-effort dispose. Transformers.js v3+ pipelines expose dispose(). */
function tryDispose(pipe: unknown): void {
  if (!pipe || typeof pipe !== 'object') return;
  const maybe = pipe as { dispose?: unknown };
  if (typeof maybe.dispose === 'function') {
    try {
      const result = (maybe as { dispose: () => unknown }).dispose();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        // Fire-and-forget; don't block the caller.
        void (result as Promise<unknown>).catch(() => { /* ignore */ });
      }
    } catch {
      /* ignore */
    }
  }
}

/** Evict oldest entries until cache is at or below MAX_PIPELINES - 1. */
function evictToFit(): void {
  while (pipelineCache.size >= MAX_PIPELINES) {
    const oldestKey = pipelineCache.keys().next().value;
    if (oldestKey === undefined) break;
    const old = pipelineCache.get(oldestKey);
    pipelineCache.delete(oldestKey);
    tryDispose(old);
  }
}

/** Drop the entire cache and dispose every pipeline. */
function clearAll(): void {
  for (const pipe of pipelineCache.values()) tryDispose(pipe);
  pipelineCache.clear();
}

/**
 * Browser-only: register a visibilitychange listener that evicts the
 * cache after the tab is hidden for IDLE_EVICT_MS. The listener registers
 * itself once at module load. No-ops in Node.
 */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenTimer = setTimeout(() => {
        clearAll();
        hiddenTimer = null;
      }, IDLE_EVICT_MS);
    } else if (hiddenTimer !== null) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
  });
}

/**
 * Load (or return cached) a Transformers.js v4 pipeline.
 * Key is `${task}:${model}` so the same pipeline is reused across tool
 * invocations in the same session.
 *
 * @param ctx   - Tool run context, used for progress reporting during model download.
 * @param task  - Transformers.js pipeline task name (e.g. 'sentiment-analysis').
 * @param model - HuggingFace model ID (e.g. 'Xenova/distilbert-base-uncased-finetuned-sst-2-english').
 * @param options - Additional pipeline options forwarded to the pipeline() constructor.
 */
export async function getPipeline(
  ctx: ToolRunContext,
  task: string,
  model: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const key = `${task}:${model}`;
  const cached = pipelineCache.get(key);
  if (cached) {
    // LRU bump: re-insert so this pipeline becomes the most-recently-used.
    pipelineCache.delete(key);
    pipelineCache.set(key, cached);
    return cached;
  }

  // Make room before loading the new pipeline; disposing the old freed
  // heap is most useful before allocating the next big model.
  evictToFit();

  const transformersMod = await import('@huggingface/transformers');
  const { pipeline } = transformersMod;

  // If a CDN base is configured (e.g. for the R2 self-hosting cutover),
  // mirror it into transformers.js's env.remoteHost so model weights are
  // fetched from the configured host instead of huggingface.co. Set every
  // time because env state on the library is module-global; another pipeline
  // call later in the session might be the first one after setModelCdn ran.
  const cdnBase = getModelCdn();
  if (cdnBase !== null) {
    const env = (transformersMod as { env?: { remoteHost?: string } }).env;
    if (env) env.remoteHost = cdnBase;
  }

  // Aggregate progress across files. Transformers.js emits per-file events
  // (initiate, download, progress, done) which would otherwise show as
  // "0% → 100% → 0% → 100%..." resetting per file. We track each file's
  // bytes and emit an overall byte-weighted percent.
  const fileBytes = new Map<string, { loaded: number; total: number }>();

  function fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  const pipe = await pipeline(task as Parameters<typeof pipeline>[0], model, {
    ...options,
    // Progress callback receives an untyped object from the Transformers.js library.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (p: any) => {
      /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
      const file: string = typeof p.file === 'string' ? p.file : '';
      const loaded: number =
        typeof p.loaded === 'number' ? p.loaded : 0;
      const total: number = typeof p.total === 'number' ? p.total : 0;

      // 'progress' / 'downloading' events carry byte counts. Update our
      // per-file tally; emit aggregated progress.
      if ((p.status === 'progress' || p.status === 'downloading') && file && total > 0) {
        fileBytes.set(file, { loaded, total });
      } else if (p.status === 'done' && file) {
        // Completed file: ensure loaded === total for accurate aggregate.
        const existing = fileBytes.get(file);
        if (existing) {
          fileBytes.set(file, { loaded: existing.total, total: existing.total });
        }
      }

      if (fileBytes.size > 0) {
        const agg = { loaded: 0, total: 0 };
        for (const v of fileBytes.values()) {
          agg.loaded += v.loaded;
          agg.total += v.total;
        }
        const percent = agg.total > 0 ? Math.round((agg.loaded / agg.total) * 100) : undefined;
        ctx.onProgress({
          stage: 'loading-deps',
          percent,
          message: `Loading ${model} — ${fmtBytes(agg.loaded)} / ${fmtBytes(agg.total)} (${fileBytes.size} file${fileBytes.size === 1 ? '' : 's'})`,
        });
      }
      /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    },
  } as Parameters<typeof pipeline>[2]);

  pipelineCache.set(key, pipe);
  return pipe;
}

/**
 * Manually drop the in-memory pipeline cache. Useful for a "Free up
 * memory" affordance on `/settings`. Does not affect the SW disk cache,
 * so subsequent loads remain fast.
 */
export function clearPipelineCache(): void {
  clearAll();
}
