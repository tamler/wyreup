import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';

let distDir: string;
let evidenceDir: string;
let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let server: Awaited<ReturnType<typeof serveBuiltCatalog>>;
let browser: Browser;
beforeAll(async () => {
  evidenceDir = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-pdf-production-')));
  if (process.env.WYREUP_CATALOG_DIST) distDir = await realpath(process.env.WYREUP_CATALOG_DIST);
  else {
    fixture = await buildProductionCatalogFixture({ webDir: fileURLToPath(new URL('..', import.meta.url)), evidenceDir });
    distDir = fixture.distDir;
  }
  server = await serveBuiltCatalog({ distDir, headersFile: join(distDir, '_headers'), deadlineAt: Date.now() + 120000 });
  browser = await chromium.launch({ headless: true });
}, 240000);
afterAll(async () => {
  const results = await Promise.allSettled([browser?.close(), server?.close(), fixture?.close()]);
  const errors: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') errors.push(result.reason as unknown);
  if (errors.length) throw new AggregateError(errors, 'Owned PDF acceptance cleanup failed.');
}, 15000);

it.each(['pdf-crop', 'pdf-redact'])('%s completes a nonblank first canvas on its genuine emitted route', async (id) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  const responses: { url: string; status: number }[] = [];
  const external: string[] = [];
  const fixturePath = fileURLToPath(new URL('../../core/test/fixtures/doc-a.pdf', import.meta.url));
  const fixture = await readFile(fixturePath);
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const sourcePath = fileURLToPath(new URL(`../src/components/runners/${id === 'pdf-crop' ? 'PdfCropRunner' : 'PdfRedactRunner'}.svelte`, import.meta.url));
  const source = await readFile(sourcePath);
  const copiedSource = await readFile(join(distDir, '../src/components/runners', id === 'pdf-crop' ? 'PdfCropRunner.svelte' : 'PdfRedactRunner.svelte'));
  expect(sha(copiedSource)).toBe(sha(source));
  page.on('pageerror', (error) => { if (errors.length < 100) errors.push(error.message); });
  page.on('console', (message) => { if (message.type() === 'error' && errors.length < 100) errors.push(message.text()); });
  page.on('response', (response) => { if (responses.length < 100) responses.push({ url: response.url(), status: response.status() }); });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== server.url) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  let observation: { width: number; height: number; darkPixels: number } | null = null;
  try {
    await page.goto(`${server.url}/tools/${id}/`);
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
    await (await choosing).setFiles({ name: 'doc-a.pdf', mimeType: 'application/pdf', buffer: fixture });
    await expect.poll(async () => {
      observation = await page.locator('canvas.pdf-canvas').evaluateAll((canvases) => {
        const canvas = canvases[0] as HTMLCanvasElement | undefined;
        if (!canvas) return null;
        const context = canvas.getContext('2d');
        if (!context || canvas.width < 1 || canvas.height < 1) return { width: canvas.width, height: canvas.height, darkPixels: 0 };
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let darkPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset + 3] > 0 && (pixels[offset] < 240 || pixels[offset + 1] < 240 || pixels[offset + 2] < 240)) darkPixels++;
        return { width: canvas.width, height: canvas.height, darkPixels };
      });
      return observation?.darkPixels ?? 0;
    }, { timeout: 5000 }).toBeGreaterThan(0);
    expect(external).toEqual([]);
  } finally {
    await writeFile(join(evidenceDir, `integration-pdf-first-render-${id}-before-1.json`), JSON.stringify({
      scope: 'Genuine retained production build BEFORE only; bounded first 100 error/response observations; no geometry or final acceptance',
      distDir, id, fixture: { path: fixturePath, bytes: fixture.length, sha256: sha(fixture) },
      currentAndCopiedSource: { path: sourcePath, sha256: sha(source), bytes: source.length },
      headersSha256: sha(await readFile(join(distDir, '_headers'))), observation, errors, responses, external,
    }, null, 2) + '\n', { flag: 'wx' });
    await page.close();
  }
}, 30000);
