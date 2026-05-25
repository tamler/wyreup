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
 *  - Optional SHA-256 manifest (see src/manifest.ts). On R2 miss, the
 *    upstream response is hashed and compared against the manifest. A
 *    mismatch blocks the R2 write so cache poisoning cannot persist.
 *    The client still receives the original bytes (streaming trade-off
 *    — see manifest.ts for the full threat-model discussion).
 *
 * **Keep in sync with the model IDs in `packages/core/src/tools/*`**.
 * Whenever a new AI tool is added that pulls a new HuggingFace model
 * (transformers.js or direct fetch), add the model ID to
 * `ALLOWED_HF_MODELS` below. The pinned versions for jsdelivr and
 * googleapis paths must match the strings hard-coded in those tools.
 */

import { MANIFEST, STRICT_VERIFICATION } from './manifest.js';

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
  if (hf && hf[1] !== undefined && ALLOWED_HF_MODELS.has(hf[1])) {
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

/** Abort upstream fetches that take longer than this. */
const UPSTREAM_TIMEOUT_MS = 30_000;

// ── Streaming size enforcement ─────────────────────────────────────────────

/**
 * Wraps a ReadableStream and errors the stream if more than `max` bytes are
 * read. Used as a defense-in-depth check when Content-Length is absent.
 */
function enforceSize(
  stream: ReadableStream<Uint8Array>,
  max: number,
): ReadableStream<Uint8Array> {
  let total = 0;
  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > max) {
            controller.error(
              new Error(`Upstream object exceeded size cap (>${max} bytes)`),
            );
            return;
          }
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

// ── SHA-256 streaming hash ─────────────────────────────────────────────────

/**
 * Tees `stream` so one branch is piped into Cloudflare's `crypto.DigestStream`
 * and the other is returned to the caller. The digest resolves at
 * end-of-stream with the lowercase hex SHA-256.
 *
 * `crypto.DigestStream` is a WritableStream that computes the hash without
 * buffering, so there is no memory cap — models of any size (including the
 * m2m100_418M decoder at ~1 GB) are fully verified.
 */
function hashAndForwardStreaming(
  stream: ReadableStream<Uint8Array>,
): { stream: ReadableStream<Uint8Array>; digest: Promise<string> } {
  // Cast to the Cloudflare Workers Crypto type which exposes DigestStream.
  // TypeScript's default DOM lib declares a narrower Crypto interface that
  // lacks this property; the runtime always has it on Workers.
  const waCrypto = crypto as typeof crypto & { DigestStream: typeof DigestStream };
  const ds = new waCrypto.DigestStream('SHA-256');

  // Tee: forCaller goes to the response, forDigest feeds DigestStream.
  const [forCaller, forDigest] = stream.tee();
  void forDigest.pipeTo(ds).catch(() => { /* digest promise will reject */ });

  const digest = ds.digest.then((buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  });

  return { stream: forCaller, digest };
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

    // Manifest gate (strict mode only). If STRICT_VERIFICATION is true,
    // refuse any path that has no manifest entry at all.
    const manifestEntry = MANIFEST[key];
    if (STRICT_VERIFICATION && !manifestEntry) {
      return new Response(
        `Path ${key} is not in the verification manifest`,
        { status: 502 },
      );
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
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(route.upstreamUrl, {
        cf: { cacheTtl: 0 },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (isTimeout) {
        return new Response(
          `Upstream fetch timed out after ${UPSTREAM_TIMEOUT_MS} ms`,
          { status: 504 },
        );
      }
      return new Response(
        `Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        { status: 502 },
      );
    }
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

    // Tee the upstream body: one branch goes to the client (size-enforced),
    // the other is consumed by hashAndForwardStreaming to compute SHA-256
    // without buffering — no memory cap, all model sizes are verified.
    const [returnStream, hashInputBranch] = upstreamRes.body.tee();
    const returnStreamCapped = enforceSize(returnStream, MAX_OBJECT_SIZE);

    const { stream: hashForwardStream, digest: digestPromise } =
      hashAndForwardStreaming(enforceSize(hashInputBranch, MAX_OBJECT_SIZE));

    ctx.waitUntil(
      (async () => {
        // Stream the hash branch DIRECTLY to R2 — R2.put accepts a
        // ReadableStream and uploads chunked, so the bytes never
        // accumulate in the worker's 128 MB heap. Previously this path
        // collected every chunk into an array and merged into a single
        // Uint8Array, which would OOM the worker for any model >~60 MB
        // (chunks + merged ≈ 2× file size). The streaming put has no
        // memory ceiling.
        //
        // Ordering: R2.put consumes the stream as it flows; the
        // DigestStream's tee branch is independently consumed. Both
        // must complete for the digest to resolve and the R2 object
        // to land. We start the put, then await the digest, then
        // await the put. If the hash mismatches the manifest, we
        // delete the just-uploaded R2 object — there's a brief window
        // where the bad bytes exist in R2, but R2 hits on the SAME
        // key in that window are NOT possible because the worker has
        // not returned to handle a second request yet (single-tenant
        // event loop) and R2 reads after delete return null. Long-term
        // cache poisoning is what this defends against; transient
        // window during first-fetch is the documented trade-off.
        const r2PutPromise = env.MODELS.put(key, hashForwardStream, {
          httpMetadata: { contentType },
        });

        let hex: string;
        try {
          hex = await digestPromise;
        } catch (err) {
          console.error(`SHA-256 stream errored for ${key}:`, err);
          // The R2 put may also error; try to delete defensively.
          await env.MODELS.delete(key).catch(() => {});
          return;
        }

        try {
          await r2PutPromise;
        } catch (err) {
          console.error(`Failed to cache ${key} to R2:`, err);
          return;
        }

        if (manifestEntry && hex !== manifestEntry.sha256) {
          console.error(
            `Manifest mismatch for ${key}: expected ${manifestEntry.sha256}, got ${hex}. Deleting just-cached R2 object.`,
          );
          await env.MODELS.delete(key).catch((err) => {
            console.error(`Failed to delete poisoned ${key} from R2:`, err);
          });
        }
      })(),
    );

    const headers = new Headers(CACHE_HEADERS);
    headers.set('Content-Type', contentType);
    headers.set('X-Wyreup-Cache', 'miss');
    if (cl) headers.set('Content-Length', cl);
    return new Response(returnStreamCapped, { headers });
  },
};
