/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Injected by vite-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Runtime caching for CDN assets
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Intercept POST /share from Web Share Target
  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Runtime cache for CDN assets (jsdelivr, Google Storage, HuggingFace)
  if (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'storage.googleapis.com' ||
    url.hostname === 'huggingface.co'
  ) {
    event.respondWith(cacheFirst(event.request, 'wyreup-cdn-assets'));
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
