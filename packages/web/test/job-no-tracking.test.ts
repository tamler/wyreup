import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';

let server: Awaited<ReturnType<typeof serveBuiltCatalog>> | undefined;
let browser: Browser | undefined;
let ownedFixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let setupFailed = false;
let setupFailure: unknown;
beforeAll(async () => {
  const started = Date.now();
  try {
    let distDir = process.env.WYREUP_CATALOG_DIST;
    if (!distDir) {
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      const evidenceDir = join(
        root,
        'docs/catalog-artifacts',
        `job-no-tracking-${randomUUID()}`,
        'build-evidence',
      );
      await mkdir(evidenceDir, { recursive: true });
      ownedFixture = await buildProductionCatalogFixture({
        webDir: fileURLToPath(new URL('..', import.meta.url)),
        evidenceDir,
        deadlineAt: started + 230000,
      });
      distDir = ownedFixture.distDir;
    }
    server = await serveBuiltCatalog({
      distDir,
      headersFile: join(distDir, '_headers'),
      deadlineAt: Date.now() + 60000,
    });
    browser = await chromium.launch({ headless: true, timeout: 10000 });
  } catch (error) {
    setupFailed = true;
    setupFailure = error;
    throw error;
  }
}, 240000);
afterAll(async () => {
  const results = await Promise.allSettled([browser?.close(), server?.close()]);
  const fixtureResults = await Promise.allSettled([ownedFixture?.close()]);
  const failures: unknown[] = [];
  for (const result of [...results, ...fixtureResults]) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason;
      failures.push(reason);
    }
  }
  if (failures.length)
    throw new AggregateError(
      setupFailed ? [setupFailure, ...failures] : failures,
      'Owned job navigation cleanup failed.',
    );
});

it('real emitted job link navigates to its PRO tool without reporting a click metric', async () => {
  const context = await browser!.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const metrics: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/metrics/hit')
      metrics.push(request.postData() ?? '');
  });
  try {
    const response = await page.goto(server!.url + '/transcribe-a-recording/');
    expect(response?.status()).toBe(200);
    const anchor = page.locator('a[data-seam="transcribe-pro"]');
    expect(await anchor.getAttribute('href')).toBe('/tools/transcribe-pro');
    const navigation = page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() &&
        new URL(response.url()).pathname === '/tools/transcribe-pro/',
    );
    await anchor.click();
    expect((await navigation).status()).toBe(200);
    await page.waitForURL('**/tools/transcribe-pro/');
    expect(new URL(page.url()).pathname).toBe('/tools/transcribe-pro/');
    await page.getByRole('heading', { name: /^Transcribe Audio/, level: 1 }).waitFor();
    expect(metrics).toEqual([]);
  } finally {
    await context.close();
  }
}, 20000);
