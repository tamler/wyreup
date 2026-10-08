import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

async function waitForRegistration(page, expected) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const matched = await page.evaluate(async (state) => {
      const registration = await navigator.serviceWorker.getRegistration();
      return state === 'waiting'
        ? registration?.waiting?.state === 'installed'
        : registration?.active?.state === 'activated' && registration.waiting === null;
    }, expected);
    if (matched) return;
    await delay(50);
  }
  throw new Error(`Service worker did not reach ${expected} state`);
}

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const originalWorker = await readFile(path.join(directory, 'sw.js'), 'utf8');
let serveUpdate = false;
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(directory, `.${pathname}`);
    if (
      !filename.startsWith(`${path.resolve(directory)}${path.sep}`) &&
      filename !== path.resolve(directory)
    ) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(filename).catch(() => null);
    if (info?.isDirectory()) filename = path.join(filename, 'index.html');
    else if (!info) filename += '.html';
    if (!(await stat(filename).catch(() => null))?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', types[path.extname(filename)] ?? 'application/octet-stream');
    if (pathname === '/sw.js') {
      response.setHeader('Cache-Control', 'no-store');
      response.end(originalWorker + (serveUpdate ? '\n// PWA acceptance update\n' : ''));
    } else
      createReadStream(filename)
        .on('error', () => response.destroy())
        .pipe(response);
  })().catch(() => response.writeHead(500).end());
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
let browser;
try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  context.on('console', (message) => {
    if (message.type() === 'error') console.error('Browser:', message.text());
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(origin);
  await waitForRegistration(page, 'active');
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute('href'),
    '/manifest.webmanifest',
  );
  const shared = await page.evaluate(async () => {
    const form = new FormData();
    form.append(
      'files',
      new File(['PWA shared fixture'], 'pwa-fixture.txt', { type: 'text/plain' }),
    );
    form.append('title', 'PWA fixture');
    form.append('text', 'Shared from acceptance');
    form.append('url', 'https://example.com/pwa-fixture');
    const redirect = await fetch('/share', { method: 'POST', body: form, redirect: 'manual' });
    const response = await fetch('/share', { method: 'POST', body: form });
    const cache = await caches.open('wyreup-share-intake');
    const file = await cache.match('/wyreup-share-file-0');
    const metadata = await cache.match('/wyreup-share-meta');
    const result = {
      status: response.status,
      redirectType: redirect.type,
      redirectStatus: redirect.status,
      path: new URL(response.url).pathname,
      contents: file ? await file.text() : null,
      filename: file?.headers.get('X-File-Name'),
      metadata: metadata ? await metadata.json() : null,
    };
    await caches.delete('wyreup-share-intake');
    return result;
  });
  assert.equal(shared.status, 200);
  assert.equal(shared.redirectType, 'opaqueredirect');
  assert.equal(shared.redirectStatus, 0);
  assert.equal(shared.path, '/share-receive');
  assert.equal(shared.contents, 'PWA shared fixture');
  assert.equal(shared.filename, 'pwa-fixture.txt');
  assert.equal(shared.metadata?.count, 1);
  assert.equal(shared.metadata?.title, 'PWA fixture');
  assert.equal(shared.metadata?.text, 'Shared from acceptance');
  assert.equal(shared.metadata?.url, 'https://example.com/pwa-fixture');
  console.log('POST file-share bytes, metadata and redirect: passed');
  await context.setOffline(true);
  await page.goto(`${origin}/pwa-acceptance-uncached-route`);
  assert.match(await page.locator('h1').innerText(), /offline/i);
  await page.goto(`${origin}/tools/compress`);
  assert.match(await page.locator('h1').innerText(), /compress/i);
  await page.goto(`${origin}/tools/compress/`);
  assert.match(await page.locator('h1').innerText(), /compress/i);
  await page.goto(`${origin}/tools/compress?source=pwa-acceptance`);
  assert.match(await page.locator('h1').innerText(), /compress/i);
  assert.equal(new URL(page.url()).searchParams.get('source'), 'pwa-acceptance');
  await page.goto(`${origin}/tools/compress/?source=pwa-acceptance`);
  assert.match(await page.locator('h1').innerText(), /compress/i);
  assert.equal(new URL(page.url()).searchParams.get('source'), 'pwa-acceptance');
  const uncachedUrl = `${origin}/pwa-acceptance-uncached-route`;
  await page.goto(uncachedUrl);
  assert.match(await page.locator('h1').innerText(), /offline/i);
  const reconnectNavigation = page.waitForNavigation({ waitUntil: 'load' });
  await context.setOffline(false);
  const reconnectResponse = await reconnectNavigation;
  assert.equal(reconnectResponse?.url(), uncachedUrl);
  assert.equal(reconnectResponse?.status(), 404);
  serveUpdate = true;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await waitForRegistration(page, 'waiting');
  assert.equal(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return (
        registration.active.state === 'activated' && registration.waiting.state === 'installed'
      );
    }),
    true,
  );
  await page.close();
  const nextPage = await context.newPage();
  await nextPage.goto(origin);
  await waitForRegistration(nextPage, 'active');
  console.log(
    JSON.stringify({
      registration: 'passed',
      postFileShare: 'passed',
      offlineUncachedNavigation: 'passed',
      offlineCachedTool: 'passed',
      offlineCachedToolTrailingSlash: 'passed',
      offlineCachedToolQueries: 'passed',
      offlineDocumentRefreshesOnReconnect: 'passed',
      updateWaitsForActiveClient: 'passed',
      updateActivatesAfterClientCloses: 'passed',
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
