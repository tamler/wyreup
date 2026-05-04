/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { setCatchHandler } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

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

async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const title = formData.get('title') as string | null;
    const text = formData.get('text') as string | null;
    const url = formData.get('url') as string | null;

    // Store share data in Cache API under a well-known key
    if (files.length > 0) {
      const cache = await caches.open('wyreup-share-intake');
      // Store each file as a Response with a predictable URL key
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const response = new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': file.name,
            'X-Share-Title': title ?? '',
            'X-Share-Text': text ?? '',
            'X-Share-Url': url ?? '',
          },
        });
        await cache.put(`/wyreup-share-file-${i}`, response);
      }
      // Store file count so the receive page knows how many to read
      await cache.put(
        '/wyreup-share-meta',
        new Response(JSON.stringify({ count: files.length, title, text, url }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
  } catch {
    // If anything fails, still redirect gracefully
  }

  return Response.redirect('/share-receive', 303);
}

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
