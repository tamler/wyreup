import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serveBuiltCatalog } from './productionBrowserHarness';

let browser: Browser;
let html: string;
let server: Awaited<ReturnType<typeof serveBuiltCatalog>>;

beforeAll(async () => {
  // Exercise the built, shareable Astro HTML rather than a copy of the script.
  html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  expect(html).toContain('/api/metrics/ref');
  server = await serveBuiltCatalog({
    distDir: fileURLToPath(new URL('../dist/', import.meta.url)),
    headersFile: fileURLToPath(new URL('../public/_headers', import.meta.url)),
  });
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { if (browser) await browser.close(); if (server) await server.close(); });

describe('campaign ref navigation', () => {
  it.each(['delayed', '429', '503'] as const)('propagates an approved tag when the counter is %s', async (outcome) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    let postCount = 0;
    let releasePost: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { releasePost = resolve; });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/metrics/ref') {
        postCount++;
        expect(route.request().postDataJSON()).toEqual({ ref: 'youtube' });
        expect(route.request().headers().cookie).toBeUndefined();
        if (outcome === 'delayed') await pending;
        await route.fulfill({ status: outcome === 'delayed' ? 200 : Number(outcome), contentType: 'application/json', body: '{}' }).catch(() => {});
      } else if (url.pathname === '/') {
        await route.fulfill({ contentType: 'text/html', body: html });
      } else if (url.pathname === '/target') {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>target</title>' });
      } else {
        await route.abort().catch(() => {});
      }
    });
    try {
      await page.goto('https://wyreup.test/?ref=youtube', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const a = document.createElement('a');
        a.href = '/target';
        a.textContent = 'target';
        a.id = 'ref-test-target';
        document.body.append(a);
      });
      await page.click('#ref-test-target');
      expect(page.url()).toBe('https://wyreup.test/target?ref=youtube');
      expect(postCount).toBe(1);
    } finally {
      releasePost?.();
      await context.close();
    }
  });

  it('uses the same shared HTML and never propagates an unapproved personal-looking value', async () => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    let posts = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/metrics/ref') { posts++; await route.abort(); }
      else if (url.pathname === '/') await route.fulfill({ contentType: 'text/html', body: html });
      else if (url.pathname === '/target') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>target</title>' });
      else await route.abort().catch(() => {});
    });
    try {
      await page.goto('https://wyreup.test/?ref=person-123', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const a = document.createElement('a');
        a.href = '/target';
        a.textContent = 'target';
        a.id = 'ref-test-target';
        document.body.append(a);
      });
      await page.click('#ref-test-target');
      expect(page.url()).toBe('https://wyreup.test/target');
      expect(posts).toBe(0);
      expect(html).not.toContain('person-123');
    } finally { await context.close(); }
  });

  it('preserves the ref through the actual homepage keyboard search', async () => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/api/metrics/ref', (route) => route.fulfill({ status: 503, body: '{}' }));
    try {
      await page.goto(`${server.url}/?ref=youtube`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('astro-island[component-url*="HeroSearch"][ssr]'));
      const input = page.getByRole('combobox', { name: 'Describe what you need' });
      await input.fill('compress photo');
      await input.press('Enter');
      await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === '/tools' && url.searchParams.get('q') === 'compress photo' && url.searchParams.get('ref') === 'youtube');
    } finally { await context.close(); }
  });

  it('preserves the ref through the actual file-to-tool handoff', async () => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/api/metrics/ref', (route) => route.fulfill({ status: 503, body: '{}' }));
    try {
      await page.goto(`${server.url}/compress-photo-for-email/?ref=rumble`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('astro-island[component-url*="JobLauncher"][ssr]'));
      await page.locator('.job-launcher input[type="file"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('photo') });
      await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === '/tools/compress' && url.searchParams.get('ref') === 'rumble');
    } finally { await context.close(); }
  });

  it('keeps fragment-only links local and carries the ref through same-path navigation', async () => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/api/metrics/ref', (route) => route.fulfill({ status: 503, body: '{}' }));
    try {
      await page.goto(`${server.url}/tools/?ref=youtube`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const fragment = document.createElement('a');
        fragment.id = 'fragment-ref-test';
        fragment.href = '#section';
        fragment.textContent = 'fragment';
        document.body.append(fragment);
      });
      await page.click('#fragment-ref-test');
      expect(new URL(page.url()).searchParams.get('ref')).toBe('youtube');
      expect(new URL(page.url()).hash).toBe('#section');
      await page.evaluate(() => {
        const samePath = document.createElement('a');
        samePath.id = 'same-path-ref-test';
        samePath.href = '/tools/?view=all#results';
        samePath.textContent = 'same path';
        document.body.append(samePath);
      });
      await page.click('#same-path-ref-test');
      const destination = new URL(page.url());
      expect(destination.pathname).toBe('/tools/');
      expect(destination.searchParams.get('view')).toBe('all');
      expect(destination.searchParams.get('ref')).toBe('youtube');
      expect(destination.hash).toBe('#results');
      await page.evaluate(() => {
        const plain = document.createElement('a');
        plain.id = 'plain-path-ref-test';
        plain.href = '/tools/';
        plain.textContent = 'plain path';
        document.body.append(plain);
      });
      await page.click('#plain-path-ref-test');
      const plainDestination = new URL(page.url());
      expect(plainDestination.pathname).toBe('/tools/');
      expect(plainDestination.searchParams.get('ref')).toBe('youtube');
      expect(plainDestination.searchParams.has('view')).toBe(false);
    } finally { await context.close(); }
  });
});
