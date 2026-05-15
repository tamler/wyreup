/**
 * Single configuration point for where AI / model weights are fetched from.
 *
 * Two distinct fetch paths:
 *
 * 1. **Direct fetches** — face-blur, audio-enhance, convert-geo construct
 *    full URLs in code (model files, WASM bundles). Call `modelUrl(path,
 *    upstreamFallback)` instead of hard-coding the upstream URL. When no
 *    CDN base is set, the helper returns the upstream fallback unchanged
 *    (no behaviour change). When a base is set (e.g. R2), the helper
 *    rewrites the URL to that base.
 *
 * 2. **transformers.js pipelines** — text-sentiment, text-ner, image-caption,
 *    etc. use `@huggingface/transformers`, which fetches model files from
 *    `huggingface.co` internally based on a model id (`Xenova/...`). The
 *    library exposes `env.remoteHost` to override that default. Calling
 *    `setModelCdn(base)` also configures `env.remoteHost` so transformers
 *    pipelines automatically follow the same redirect.
 *
 * **Migration path to R2 self-hosting** (documented; not yet executed):
 *  - Set up an R2 bucket `wyreup-models` with the upstream layout mirrored
 *    underneath it. For transformers.js, mirror the per-model directory
 *    structure (e.g. `wyreup-models/Xenova/distilbert-.../onnx/...`).
 *  - In the web app's BaseLayout (or per-surface startup), call
 *    `setModelCdn('https://models.wyreup.com')`.
 *  - For CLI / MCP, expose a `WYREUP_MODEL_CDN_BASE` env var and call
 *    `setModelCdn(process.env.WYREUP_MODEL_CDN_BASE)` at startup.
 *  - Update the privacy scan allow-list in `tools/check-privacy.mjs` to
 *    remove `jsdelivr.net`, `googleapis.com`, and `huggingface.co` after
 *    confirming no remaining touches.
 *
 * Defaults stay the upstream CDNs so this refactor is a pure no-op until
 * the bucket is provisioned and `setModelCdn` is called.
 */

let CONFIGURED_BASE: string | null = null;

/**
 * Set the base URL all model assets resolve under. Pass `null` (or call
 * with no arguments) to reset to upstream defaults.
 *
 * If a `@huggingface/transformers` runtime is already loaded, its
 * `env.remoteHost` is mirrored to the same value so pipeline-based tools
 * follow the redirect automatically. (We do this best-effort — if
 * transformers isn't loaded yet, the next `getPipeline()` call will pick
 * up the configured value when it imports the library.)
 */
export function setModelCdn(base: string | null = null): void {
  CONFIGURED_BASE = base && base.length > 0 ? base.replace(/\/$/, '') : null;
  // Best-effort: try to update transformers.js env.remoteHost if loaded.
  // We avoid importing transformers eagerly so this function doesn't pull
  // in 1MB of library code when consumers only need direct-URL resolution.
  void tryUpdateTransformersHost();
}

/** Returns the currently configured CDN base, or null if defaults are in use. */
export function getModelCdn(): string | null {
  return CONFIGURED_BASE;
}

/**
 * Resolve a model asset URL. When no CDN base is configured, returns the
 * upstream URL unchanged. When one is set, the relative `path` is appended
 * to the base — call sites pass paths shaped like the upstream layout so
 * a mirrored bucket works without any further config.
 */
export function modelUrl(path: string, upstreamFallback: string): string {
  if (CONFIGURED_BASE === null) return upstreamFallback;
  const trimmed = path.replace(/^\//, '');
  return `${CONFIGURED_BASE}/${trimmed}`;
}

async function tryUpdateTransformersHost(): Promise<void> {
  if (CONFIGURED_BASE === null) return;
  try {
    const mod = (await import('@huggingface/transformers').catch(() => null)) as
      | { env?: { remoteHost?: string; remotePathTemplate?: string } }
      | null;
    if (mod?.env) {
      mod.env.remoteHost = CONFIGURED_BASE;
    }
  } catch {
    // transformers.js not available or failed to import — fine, the
    // pipeline loader will retry the env.remoteHost write when it imports
    // the library itself.
  }
}
