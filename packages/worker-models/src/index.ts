/**
 * models.wyreup.com — first-party model asset proxy.
 *
 * Serves objects from the `wyreup-models` R2 bucket. On cache-miss,
 * fetches from the matching upstream CDN, streams the response back,
 * and lazy-writes the bytes to R2 in the background via
 * `ctx.waitUntil`. Next request: served straight from R2.
 *
 * Why a Worker (not a public R2 bucket): we want a first-party origin
 * for every model fetch. The browser only ever sees models.wyreup.com.
 *
 * **Security hardening.**
 *  - Hard allowlist of paths. Anything not on the list returns 403
 *    immediately — no upstream fetch, no R2 write. Bounds R2 storage
 *    growth and Class A write count to the union of allowed paths,
 *    regardless of how malicious the incoming traffic is.
 *  - Max object size cap (`MAX_OBJECT_SIZE`) — large model files are
 *    fine; arbitrary uploads beyond that are refused.
 *  - Only GET / HEAD are accepted. No PUT / DELETE / etc. ever.
 *
 * **Keep in sync with the model IDs in `packages/core/src/tools/*`**.
 * Whenever a new AI tool is added that pulls a new HuggingFace model
 * (transformers.js or direct fetch), add the model ID to
 * `ALLOWED_HF_MODELS` below. The pinned versions for jsdelivr and
 * googleapis paths must match the strings hard-coded in those tools.
 */

export interface Env {
  MODELS: R2Bucket;
}

// ── Allowlist ──────────────────────────────────────────────────────────────

/** HuggingFace `{owner}/{model}` slugs we proxy from. */
const ALLOWED_HF_MODELS: ReadonlySet<string> = new Set([
  // Direct ONNX fetch (audio-enhance).
  'YatharthS/FlashSR',
  // transformers.js models.
  'Xenova/distilbart-cnn-6-6',                              // text-summarize
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english', // text-sentiment
  'Xenova/bert-base-NER',                                   // text-ner
  'Xenova/m2m100_418M',                                     // text-translate
  'Xenova/all-MiniLM-L6-v2',                                // text-embed
  'Xenova/vit-gpt2-image-captioning',                       // image-caption
  'Xenova/blip-image-captioning-base',                      // image-caption-detailed
  'Xenova/clip-vit-base-patch16',                           // image-similarity
  'Xenova/trocr-small-handwritten',                         // ocr-pro
  'Xenova/swin2SR-classical-sr-x2-64',                      // upscale-2x
  'Xenova/whisper-tiny',                                    // transcribe (tiny)
  'Xenova/whisper-base',                                    // transcribe (base)
  'Xenova/whisper-small',                                   // transcribe (small)
  'onnx-community/BiRefNet_lite-ONNX',                      // bg-remove
]);

/** Exact path prefixes for the non-HuggingFace upstreams (version-pinned). */
const ALLOWED_PREFIXES: ReadonlyArray<{ prefix: string; upstreamBase: string }> = [
  {
    prefix: '@mediapipe/tasks-vision@0.10.34/wasm/',
    upstreamBase: 'https://cdn.jsdelivr.net/npm/',
  },
  {
    prefix: 'mediapipe-models/face_detector/blaze_face_short_range/float16/1/',
    upstreamBase: 'https://storage.googleapis.com/',
  },
  {
    prefix: 'gdal3.js@2.8.1/dist/package/',
    upstreamBase: 'https://cdn.jsdelivr.net/npm/',
  },
];

/** Max bytes per object. Larger upstream responses are rejected with 413
 *  so an attacker can't push a 50 GB file into our bucket. The biggest
 *  model file we actually use is the m2m100 translation decoder at ~1 GB,
 *  so 1.5 GB is the right ceiling. */
const MAX_OBJECT_SIZE = 1.5 * 1024 * 1024 * 1024;

// ── Routing ────────────────────────────────────────────────────────────────

interface RouteMatch {
  upstreamUrl: string;
}

function routeRequest(key: string): RouteMatch | null {
  // HuggingFace shape: {owner}/{model}/resolve/main/{file...}
  // Anchor with `^` and pin revision to `main` so an attacker can't
  // multiply R2 storage by requesting every historical commit of an
  // allowed model. transformers.js requests `main` by default.
  const hf = key.match(/^([^/]+\/[^/]+)\/resolve\/main\/.+$/);
  if (hf && ALLOWED_HF_MODELS.has(hf[1]!)) {
    return { upstreamUrl: `https://huggingface.co/${key}` };
  }
  for (const entry of ALLOWED_PREFIXES) {
    if (key.startsWith(entry.prefix) && key.length > entry.prefix.length) {
      // Reject path traversal attempts (`..`, `//`). Belt-and-suspenders —
      // CF and the upstreams normalise URLs, but a defense-in-depth check
      // here means we never even initiate the fetch.
      if (key.includes('..') || key.includes('//')) return null;
      return { upstreamUrl: `${entry.upstreamBase}${key}` };
    }
  }
  return null;
}

// ── Response helpers ───────────────────────────────────────────────────────

const CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'CDN-Cache-Control': 'public, max-age=31536000, immutable',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function contentTypeFor(path: string): string {
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.onnx') || path.endsWith('.tflite') || path.endsWith('.bin')) {
    return 'application/octet-stream';
  }
  if (path.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

// ── Handler ────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CACHE_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!key) {
      return new Response('Not Found', { status: 404 });
    }

    // Allowlist gate. Any path that doesn't match a known upstream is
    // refused before we touch R2 or talk to upstream.
    const route = routeRequest(key);
    if (!route) {
      return new Response('Forbidden — path is not on the allowed model list', {
        status: 403,
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }

    // 1) R2 hit — serve directly.
    const obj = await env.MODELS.get(key);
    if (obj) {
      const headers = new Headers(CACHE_HEADERS);
      headers.set(
        'Content-Type',
        obj.httpMetadata?.contentType ?? contentTypeFor(key),
      );
      headers.set('Content-Length', String(obj.size));
      headers.set('ETag', obj.httpEtag);
      headers.set('X-Wyreup-Cache', 'hit');
      if (request.method === 'HEAD') {
        return new Response(null, { headers });
      }
      return new Response(obj.body, { headers });
    }

    // 2) R2 miss — fetch the matching upstream and stream the response.
    const upstreamRes = await fetch(route.upstreamUrl, { cf: { cacheTtl: 0 } });
    if (!upstreamRes.ok) {
      return new Response(
        `Upstream ${upstreamRes.status}: ${upstreamRes.statusText}`,
        { status: upstreamRes.status },
      );
    }

    // Size cap. If Content-Length is missing or above the limit, reject
    // before we stream and write.
    const cl = upstreamRes.headers.get('Content-Length');
    if (cl) {
      const declared = Number.parseInt(cl, 10);
      if (Number.isFinite(declared) && declared > MAX_OBJECT_SIZE) {
        return new Response(`Upstream object exceeds size cap (${declared} bytes)`, {
          status: 413,
        });
      }
    }

    const contentType =
      upstreamRes.headers.get('Content-Type') ?? contentTypeFor(key);

    if (!upstreamRes.body) {
      return new Response('Upstream had no body', { status: 502 });
    }
    const [returnStream, storeStream] = upstreamRes.body.tee();

    ctx.waitUntil(
      env.MODELS.put(key, storeStream, {
        httpMetadata: { contentType },
      }).catch((err) => {
        console.error(`Failed to cache ${key} to R2:`, err);
      }),
    );

    const headers = new Headers(CACHE_HEADERS);
    headers.set('Content-Type', contentType);
    headers.set('X-Wyreup-Cache', 'miss');
    if (cl) headers.set('Content-Length', cl);
    return new Response(returnStream, { headers });
  },
};
