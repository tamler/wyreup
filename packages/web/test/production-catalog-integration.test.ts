import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';

let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let server: Awaited<ReturnType<typeof serveBuiltCatalog>> | undefined;
let browser: Browser | undefined;
let evidence: string;

beforeAll(async () => {
  evidence = await mkdtemp(join(tmpdir(), 'wyreup-production-browser-'));
  fixture = await buildProductionCatalogFixture({ webDir: fileURLToPath(new URL('..', import.meta.url)), evidenceDir: evidence });
  server = await serveBuiltCatalog({ distDir: fixture.distDir, headersFile: join(fixture.distDir, '_headers'), deadlineAt: Date.now() + 600000 });
  browser = await chromium.launch({ headless: true });
}, 240000);

afterAll(async () => {
  const results = await Promise.allSettled([browser?.close(), server?.close(), fixture?.close()]);
  const failures: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') failures.push(result.reason as unknown);
  if (failures.length) throw new AggregateError(failures, 'Owned production acceptance cleanup failed.');
}, 15000);

async function withPage(action: (page: Page) => Promise<void>) {
  const context = await browser!.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try { await action(page); } finally { await context.close(); }
}

async function artifact(page: Page, button: string, filename: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await pending;
  const path = join(evidence, filename);
  await download.saveAs(path);
  return readFile(path);
}

it('serves actual tool pages and emitted scripts under the production headers', async () => {
  const observations: unknown[] = [];
  for (const id of ['csv-viewer', 'psd-to-png', 'stl-to-gcode', 'mp3-to-midi', 'bank-statement-to-csv', 'cron-from-text', 'domain-age-checker', 'concrete-bag-calculator', 'number-base-converter']) {
    await withPage(async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(`${server!.url}/tools/${id}/`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['content-security-policy']).toBeTruthy();
      await page.getByRole('heading', { level: 1 }).waitFor();
      await expect.poll(() => page.locator('astro-island[ssr]').count()).toBe(0);
      expect(await page.getByText(/runner (is )?unavailable|not mapped/i).count()).toBe(0);
      expect(errors).toEqual([]);
      observations.push({ id, url: page.url(), heading: await page.getByRole('heading', { level: 1 }).textContent(), errors });
    });
  }
  await writeFile(join(evidence, 'actual-tool-route-observations.json'), JSON.stringify(observations, null, 2));
}, 120000);

it('reopens the complete number-base JSON artifact from the actual page', async () => {
  await withPage(async (page) => {
    await page.goto(`${server!.url}/tools/number-base-converter/`);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill('2');
    await page.getByRole('button', { name: /^Run Number Base Converter$/i }).click();
    const bytes = await artifact(page, 'Download', 'number-base-complete.json');
    expect(JSON.parse(bytes.toString('utf8'))).toEqual({ decimal: '2', binary: '10', octal: '2', hexadecimal: '2', binaryPadded: '00000010', hexPadded: '02' });
  });
}, 60000);

it('does not report PRO page views as analytics beacons', async () => {
  await withPage(async (page) => {
    const beacons: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/metrics/hit') beacons.push(request.postData() ?? '');
    });
    await page.goto(`${server!.url}/pro/`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    expect(beacons).toEqual([]);
  });
}, 60000);

it('keeps job links functional without reporting analytics clicks', async () => {
  await withPage(async (page) => {
    const beacons: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/metrics/hit') beacons.push(request.postData() ?? '');
    });
    expect((await page.goto(`${server!.url}/transcribe-a-recording/`))?.status()).toBe(200);
    const link = page.locator('a[data-seam]').first();
    expect(await link.getAttribute('href')).toBe('/tools/transcribe-pro');
    await link.click();
    await page.getByRole('heading', { level: 1 }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/tools/transcribe-pro/');
    expect(beacons).toEqual([]);
  });
}, 60000);

it('preserves the original BOM and CRLF through a target-bound stored-file handover', async () => {
  await withPage(async (page) => {
    await page.goto(`${server!.url}/acceptance/catalog/?tool=number-base-converter`);
    await page.locator('[data-ready="true"]').waitFor();
    const bytes = Buffer.from([239, 187, 191, 49, 54, 13, 10]);
    await page.getByLabel('Parent input file', { exact: true }).setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: bytes });
    await page.getByRole('button', { name: 'Stash File for selected canonical tool', exact: true }).click();
    await expect.poll(() => page.locator('[data-fixture-status]').textContent()).toContain('Stored original.txt');
    await page.getByRole('button', { name: 'Mount / remount target', exact: true }).click();
    await page.getByRole('textbox', { name: 'Input text', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Observe pending metadata', exact: true }).click();
    await expect.poll(() => page.locator('[data-fixture-status]').textContent()).toContain('Pending: original.txt');
    await page.getByRole('combobox', { name: 'Conversion', exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
    await page.getByRole('combobox', { name: 'Byte format', exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await page.getByRole('button', { name: /^Run Number Base Converter$/i }).click();
    expect((await artifact(page, 'Download', 'original-utf8-hex.txt')).toString('utf8')).toBe('ef bb bf 31 36 0d 0a');
    await page.getByRole('button', { name: 'Observe pending metadata', exact: true }).click();
    await expect.poll(() => page.locator('[data-fixture-status]').textContent()).toBe('No pending storage metadata.');
  });
}, 60000);

it('retains an unsupported original and downloads its exact bytes without running a fabricated tool', async () => {
  await withPage(async (page) => {
    await page.goto(`${server!.url}/acceptance/catalog/?tool=number-base-converter`);
    await page.locator('[data-ready="true"]').waitFor();
    await page.getByLabel('Routing-negative sentinel (not a registered tool)', { exact: true }).check();
    const bytes = Buffer.from([0, 255, 2, 3]);
    await page.getByLabel('Parent input file', { exact: true }).setInputFiles({ name: 'recovery.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByRole('button', { name: 'Deliver selected File', exact: true }).click();
    await page.getByRole('button', { name: 'Mount / remount target', exact: true }).click();
    await page.getByText(/recovery.bin.*4 bytes/).waitFor();
    expect(await artifact(page, 'Download original', 'recovered-original.bin')).toEqual(bytes);
    expect(await page.getByRole('button', { name: /^Run Number Base Converter$/i }).count()).toBe(0);
  });
}, 60000);
