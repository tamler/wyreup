/**
 * models.wyreup.com — first-party model asset proxy.
 *
 * For any incoming request, serves the matching object from the
 * `wyreup-models` R2 bucket. On cache-miss, fetches from the matching
 * upstream CDN, returns the response to the caller, and lazily writes
 * the bytes back to R2 (in the background via `ctx.waitUntil`) so the
 * next request is served from R2 directly.
 *
 * Why a Worker (not just an R2 public bucket): we want a first-party
 * origin for every model fetch — the privacy pitch is "no third-party
 * touch from the browser." The Worker is the first-party origin; the
 * browser only ever sees models.wyreup.com. The Worker does the
 * (single, server-side) upstream fetch on cold miss, then never again.
 */

export interface Env {
  MODELS: R2Bucket;
}

type UpstreamResolver = (path: string) => string | null;

/** Map request path → upstream URL. */
const RESOLVERS: UpstreamResolver[] = [
  // HuggingFace model files (covers Xenova/*, onnx-community/*, YatharthS/*, etc).
  // Path shape: {owner}/{model}/resolve/{rev}/{file...}
  (path) => {
    const m = path.match(/^[^/]+\/[^/]+\/resolve\/[^/]+\/.+$/);
    return m ? `https://huggingface.co/${path}` : null;
  },
  // MediaPipe tasks-vision WASM (face-blur).
  (path) =>
    path.startsWith('@mediapipe/tasks-vision@')
      ? `https://cdn.jsdelivr.net/npm/${path}`
      : null,
  // MediaPipe model storage (face-blur).
  (path) =>
    path.startsWith('mediapipe-models/')
      ? `https://storage.googleapis.com/${path}`
      : null,
  // gdal3.js bundle (convert-geo).
  (path) =>
    path.startsWith('gdal3.js@')
      ? `https://cdn.jsdelivr.net/npm/${path}`
      : null,
];

function resolveUpstream(path: string): string | null {
  for (const r of RESOLVERS) {
    const url = r(path);
    if (url) return url;
  }
  return null;
}

const CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'CDN-Cache-Control': 'public, max-age=31536000, immutable',
  // CORS — transformers.js, MediaPipe, and direct fetch() in the page all
  // need this when running cross-origin. Locked open since we serve only
  // public, immutable model assets.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function contentTypeFor(path: string): string {
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.onnx')) return 'application/octet-stream';
  if (path.endsWith('.tflite')) return 'application/octet-stream';
  if (path.endsWith('.bin')) return 'application/octet-stream';
  if (path.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

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
    if (!key) return new Response('Not Found', { status: 404 });

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

    // 2) R2 miss — find the upstream and stream the response back.
    const upstream = resolveUpstream(key);
    if (!upstream) {
      return new Response('Unknown asset path', { status: 404 });
    }

    const upstreamRes = await fetch(upstream, {
      // Forward If-None-Match / Range from the original request? We
      // ignore them — first-time fetches always pull the full body so
      // R2 lands a complete object. Subsequent serves go through R2.
      cf: { cacheTtl: 0 },
    });
    if (!upstreamRes.ok) {
      return new Response(
        `Upstream ${upstreamRes.status}: ${upstreamRes.statusText}`,
        { status: upstreamRes.status },
      );
    }

    const contentType =
      upstreamRes.headers.get('Content-Type') ?? contentTypeFor(key);

    // Tee the upstream body so we can both return it AND store to R2 in
    // a single pass — no double download, no buffering the full body
    // in Worker memory.
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
    const cl = upstreamRes.headers.get('Content-Length');
    if (cl) headers.set('Content-Length', cl);
    return new Response(returnStream, { headers });
  },
};
