/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { setCatchHandler } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

const SHARE_INTAKE_CACHE = 'wyreup-share-intake';
// Files larger than this are refused at intake. The Web Share Target spec
// doesn't promise a size limit; without this cap, a single shared 1 GB
// video would persist in Cache API storage indefinitely if the redirect
// to /share-receive fails or the user closes the tab.
const MAX_SHARED_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
// Orphan TTL: any share intake older than this is sweepable.
const SHARE_INTAKE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// Injected by vite-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Offline fallback for navigations: when the network is unreachable AND
// the requested URL isn't in the precache (e.g. a deep link to a page the
// user hasn't visited before, or a route added after the SW was last
// updated), serve the precached /offline.html so the user sees something
// actionable instead of the browser's default offline error.
//
// setCatchHandler runs only after every other handler has rejected, so
// the happy path (online navigation, precached navigation) is unaffected.
setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    const fallback = await matchPrecache('/offline.html');
    if (fallback) return fallback;
  }
  return Response.error();
});

// Runtime caching for CDN assets and same-origin heavy static assets.
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Intercept POST /share from Web Share Target
  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

  // Runtime cache for CDN assets (jsdelivr, Google Storage, HuggingFace)
  if (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'storage.googleapis.com' ||
    url.hostname === 'huggingface.co'
  ) {
    event.respondWith(cacheFirst(event.request, 'wyreup-cdn-assets'));
    return;
  }

  // Same-origin heavy static assets (WASM, ONNX models, blob/data files).
  // The build excludes these from precache (too large), and they're served
  // with content-hashed filenames, so cache-first is safe — when the build
  // emits a new hash, the old entry is simply unused.
  if (
    url.origin === self.location.origin &&
    /\.(wasm|onnx|data|bin|tflite|task|onnx_data)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(event.request, 'wyreup-heavy-assets'));
    return;
  }
});

/**
 * Best-effort cleanup of share-intake entries older than SHARE_INTAKE_MAX_AGE_MS.
 * If /share-receive ever fails to run its own cleanup (page crash, tab
 * close, redirect intercepted), this catches the orphan before it
 * accumulates. Called on:
 *   - service worker `activate` (deploy or first install)
 *   - the start of every handleShareTarget (defense-in-depth — bounds
 *     storage growth to roughly one share's worth of files)
 */
async function sweepStaleShareIntake(): Promise<void> {
  try {
    const cache = await caches.open(SHARE_INTAKE_CACHE);
    const metaResponse = await cache.match('/wyreup-share-meta');
    if (!metaResponse) {
      // No meta — but there might be orphan file entries left over.
      // Delete every known share-file-N key to be safe.
      const keys = await cache.keys();
      for (const req of keys) {
        if (new URL(req.url).pathname.startsWith('/wyreup-share-file-')) {
          await cache.delete(req);
        }
      }
      return;
    }
    const meta = await metaResponse.json() as { ts?: number; count?: number };
    const age = Date.now() - (meta.ts ?? 0);
    if (age > SHARE_INTAKE_MAX_AGE_MS) {
      await cache.delete('/wyreup-share-meta');
      const n = meta.count ?? 0;
      for (let i = 0; i < n; i++) {
        await cache.delete(`/wyreup-share-file-${i}`);
      }
    }
  } catch (err) {
    console.warn('[sw] share-intake sweep failed:', err);
  }
}

async function handleShareTarget(request: Request): Promise<Response> {
  // Sweep any prior intake the receive page never claimed. Bounds
  // storage growth to the current share's footprint.
  await sweepStaleShareIntake();

  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const title = formData.get('title') as string | null;
    const text = formData.get('text') as string | null;
    const url = formData.get('url') as string | null;

    // Store share data in Cache API under a well-known key
    if (files.length > 0) {
      const cache = await caches.open(SHARE_INTAKE_CACHE);
      let stored = 0;
      // Store each file as a Response with a predictable URL key
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > MAX_SHARED_FILE_BYTES) {
          // Don't cache; the user will land on /share-receive which already
          // has a "no shared file found" path. Logging here is best-effort.
          console.warn(`[sw] shared file ${file.name} exceeds ${MAX_SHARED_FILE_BYTES} bytes — skipping`);
          continue;
        }
        const response = new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': file.name,
            'X-Share-Title': title ?? '',
            'X-Share-Text': text ?? '',
            'X-Share-Url': url ?? '',
          },
        });
        await cache.put(`/wyreup-share-file-${stored}`, response);
        stored++;
      }
      // Only write meta if at least one file was stored
      if (stored > 0) {
        // Store file count so the receive page knows how many to read
        await cache.put(
          '/wyreup-share-meta',
          new Response(JSON.stringify({ count: stored, title, text, url, ts: Date.now() }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
    }
  } catch {
    // If anything fails, still redirect gracefully
  }

  return Response.redirect('/share-receive', 303);
}

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(sweepStaleShareIntake());
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    void cache.put(request, response.clone());
  }
  return response;
}
