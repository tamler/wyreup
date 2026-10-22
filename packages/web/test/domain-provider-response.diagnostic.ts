import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page, type Response } from 'playwright';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture } from './productionBrowserHarness';
import { startDomainFunctionsHost, type DomainFunctionsHost, type FilePin } from './domainFunctionsHarness.mjs';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const projectDir = resolve(webDir, '../..');
let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let browser: Browser | undefined;
let host: DomainFunctionsHost | undefined;
let evidenceDir: string;
beforeAll(async () => {
  evidenceDir = await mkdtemp(join(tmpdir(), 'wyreup-domain-response-diagnostic-'));
  fixture = await buildProductionCatalogFixture({ webDir, evidenceDir });
  console.warn(JSON.stringify({ phase: 'guarded-build-complete', evidenceDir, distDir: fixture.distDir, manifest: fixture.manifest }));
  const manifest = JSON.parse(await readFile(fixture.manifest, 'utf8')) as { coreDist: FilePin[] };
  const corePins = manifest.coreDist.map(pin => ({ ...pin, path: `packages/core/dist/${pin.path}` }));
  browser = await chromium.launch({ headless: true });
  host = await startDomainFunctionsHost({ projectDir, distDir: fixture.distDir, evidenceDir, expectedCoreDistPins: corePins, deadlineAt: Date.now() + 180000 });
}, 240000);
afterAll(async () => {
  const first = await Promise.allSettled([host?.close(), browser?.close()]);
  const second = await Promise.allSettled([fixture?.close()]);
  const errors: unknown[] = [];
  for (const result of [...first, ...second]) if (result.status === 'rejected') errors.push(result.reason as unknown);
  if (errors.length) throw new AggregateError(errors, 'Owned domain response diagnostic cleanup failed.');
}, 15000);

type Lookup = { page: Page; close(): Promise<void> };
async function openLookup(observations: unknown[]): Promise<Lookup> {
  const context = await browser!.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  context.on('serviceworker', worker => observations.push({ event: 'service-worker-created', url: worker.url(), at: Date.now() }));
  page.on('pageerror', error => observations.push({ event: 'page-error', message: error.message, at: Date.now() }));
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) observations.push({ event: 'main-frame-navigated', url: frame.url(), at: Date.now() }); });
  page.on('close', () => observations.push({ event: 'page-closed', at: Date.now() }));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/domain-age') observations.push({ event: 'request', url: request.url(), method: request.method(), postData: request.postData(), at: Date.now() }); });
  page.on('requestfinished', request => { if (new URL(request.url()).pathname === '/api/domain-age') observations.push({ event: 'request-finished', url: request.url(), failure: request.failure(), at: Date.now() }); });
  page.on('requestfailed', request => { if (new URL(request.url()).pathname === '/api/domain-age') observations.push({ event: 'request-failed', url: request.url(), failure: request.failure(), at: Date.now() }); });
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/domain-age') observations.push({ event: 'response', url: response.url(), status: response.status(), fromServiceWorker: response.fromServiceWorker(), pageUrl: page.url(), at: Date.now() }); });
  await page.goto(`${host!.url}/tools/domain-age-checker/`);
  await page.getByRole('textbox', { name: /domain/i }).waitFor();
  await page.getByRole('textbox', { name: /domain/i }).fill('example.com');
  return { page, close: () => context.close() };
}
async function calculate(page: Page): Promise<Response> {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/domain-age' && value.request().method() === 'POST');
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  return response;
}

for (const scenario of ['provider-rate-limited', 'provider-error'] as const) {
  it(`diagnostic original ${scenario} response assertion with passive lifecycle observations`, async () => {
    await host!.resetAdmission();
    await host!.setProviderScenario(scenario);
    const observations: unknown[] = [];
    const lookup = await openLookup(observations);
    let completed: Promise<void> | undefined;
    let failure: string | undefined;
    try {
      const response = await calculate(lookup.page);
      completed = response.finished().then(result => { observations.push({ event: 'response-finished-promise', error: result instanceof Error ? result.message : result, at: Date.now() }); }, error => { observations.push({ event: 'response-finished-rejected', error: error instanceof Error ? error.message : String(error), at: Date.now() }); });
      observations.push({ event: 'before-original-json-assertion', pageUrl: lookup.page.url(), responseUrl: response.url(), status: response.status(), fromServiceWorker: response.fromServiceWorker(), headers: response.headers(), at: Date.now() });
      expect(response.status()).toBe(200);
      const data = await response.json() as { status: string };
      observations.push({ event: 'original-json-result', data, pageUrl: lookup.page.url(), at: Date.now() });
      expect(data.status).toBe(scenario === 'provider-rate-limited' ? 'rate-limited' : 'provider-error');
      if (scenario === 'provider-rate-limited') expect(response.headers()['retry-after']).toBe('7');
      await expect.poll(async () => lookup.page.getByRole('alert').count()).toBeGreaterThan(0);
      expect(await lookup.page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(0);
      expect((await host!.inspect()).leaseCount).toBe(0);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await completed;
      const finalState = await Promise.allSettled([lookup.page.getByRole('alert').allTextContents(), lookup.page.evaluate(async () => ({
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(item => ({ scope: item.scope, active: item.active?.scriptURL ?? null, installingState: item.installing?.state ?? null })),
      }))]);
      observations.push({ event: 'finally-before-context-close', failure, pageUrl: lookup.page.url(), pageClosed: lookup.page.isClosed(), finalState: finalState.map(item => item.status === 'fulfilled' ? { value: item.value } : { error: item.reason instanceof Error ? item.reason.message : String(item.reason) }), at: Date.now() });
      await lookup.close(); await host!.setProviderScenario('ok');
      await writeFile(join(evidenceDir, `${scenario}-response-observations.json`), JSON.stringify({ scenario, observations, limitation: 'One bounded diagnostic copied original provider assertions; no body retry, navigation change, service-worker policy change or production edit. Not the complete original eight-case ordering.' }, null, 2) + '\n', { flag: 'wx' });
      console.warn(JSON.stringify({ scenario, evidenceDir }));
    }
  }, 60000);
}
