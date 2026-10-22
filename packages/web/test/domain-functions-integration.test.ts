import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page, type Request } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture } from './productionBrowserHarness';
import { startDomainFunctionsHost, type DomainFunctionsHost, type FilePin } from './domainFunctionsHarness.mjs';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const projectDir = resolve(webDir, '../..');
let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let browser: Browser | undefined;
let host: DomainFunctionsHost | undefined;
let evidenceDir: string;
let corePins: FilePin[];
type Owned<T extends { close(): Promise<unknown> }> = {
  acquisition: Promise<T>;
  acquired: boolean;
  closing?: Promise<unknown>;
};
let closing = false;
const closingReason = new Error('Owned domain acceptance is closing.');
let fixtureOwner: Owned<NonNullable<typeof fixture>> | undefined;
let browserOwner: Owned<Browser> | undefined;
let hostOwner: Owned<DomainFunctionsHost> | undefined;
const faultOwners: Owned<DomainFunctionsHost>[] = [];
let setupOperation: Promise<void> | undefined;
const faultOperations: Promise<void>[] = [];
const callbackCleanupErrors: unknown[] = [];

function requireOpen() {
  if (closing) throw closingReason;
}

function own<T extends { close(): Promise<unknown> }>(acquisition: Promise<T>): Owned<T> {
  const owner: Owned<T> = { acquisition, acquired: false };
  void acquisition.then(() => { owner.acquired = true; }, () => {});
  return owner;
}

function closeOwned<T extends { close(): Promise<unknown> }>(owner: Owned<T>) {
  owner.closing ??= owner.acquisition.then((value) => value.close());
  void owner.closing.catch(() => {});
  return owner.closing;
}

function observe(operation: Promise<void>) {
  void operation.catch(() => {});
  return operation;
}

beforeAll(() => {
  setupOperation = (async () => {
    requireOpen();
    evidenceDir = await mkdtemp(join(tmpdir(), 'wyreup-domain-browser-'));
    requireOpen();
    fixtureOwner = own(buildProductionCatalogFixture({ webDir, evidenceDir }));
    fixture = await fixtureOwner.acquisition;
    requireOpen();
    const manifest = JSON.parse(await readFile(fixture.manifest, 'utf8')) as { coreDist: FilePin[] };
    corePins = manifest.coreDist.map((pin) => ({ ...pin, path: `packages/core/dist/${pin.path}` }));
    requireOpen();
    browserOwner = own(chromium.launch({ headless: true }));
    browser = await browserOwner.acquisition;
    requireOpen();
    hostOwner = own(startDomainFunctionsHost({ projectDir, distDir: fixture.distDir, evidenceDir, expectedCoreDistPins: corePins, deadlineAt: Date.now() + 600000 }));
    host = await hostOwner.acquisition;
    requireOpen();
  })();
  return observe(setupOperation);
}, 240000);

afterAll(async () => {
  closing = true;
  const owners: Owned<{ close(): Promise<unknown> }>[] = [hostOwner, browserOwner, ...faultOwners]
    .filter((owner): owner is NonNullable<typeof owner> => owner !== undefined);
  const closes = owners.map((owner) => closeOwned(owner));
  const operations = setupOperation ? [setupOperation, ...faultOperations] : [...faultOperations];
  const [workResults, closeResults] = await Promise.all([
    Promise.allSettled(operations), Promise.allSettled(closes),
  ]);
  const errors: unknown[] = [];
  const retain = (reason: unknown) => { if (!errors.some((value) => Object.is(value, reason))) errors.push(reason); };
  for (const result of workResults) if (result.status === 'rejected') retain(result.reason);
  let ownerCloseFailed = false;
  for (const [index, result] of closeResults.entries()) {
    if (result.status === 'rejected' && owners[index].acquired) {
      ownerCloseFailed = true;
      retain(result.reason);
    }
  }
  if (!ownerCloseFailed && fixtureOwner) {
    const [result] = await Promise.allSettled([closeOwned(fixtureOwner)]);
    if (result.status === 'rejected' && fixtureOwner.acquired) retain(result.reason);
  }
  for (const reason of callbackCleanupErrors) retain(reason);
  if (errors.length) throw new AggregateError(errors, 'Owned domain acceptance cleanup failed.');
}, 15000);

async function openLookup(active = host!) {
  requireOpen();
  const context = await browser!.newContext({ acceptDownloads: true });
  try {
    requireOpen();
    const page = await context.newPage();
    requireOpen();
    const requests: Request[] = [];
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/domain-age') requests.push(request); });
    await page.goto(`${active.url}/tools/domain-age-checker/`);
    await page.getByRole('textbox', { name: /domain/i }).waitFor();
    await page.getByRole('textbox', { name: /domain/i }).fill('example.com');
    return { page, requests, close: () => context.close() };
  } catch (reason) {
    try { await context.close(); } catch (cleanupReason) { callbackCleanupErrors.push(cleanupReason); }
    throw reason;
  }
}

async function calculate(page: Page) {
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === '/api/domain-age' && value.request().method() === 'POST');
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  return response;
}

it('uses the real page, same-origin POST, native D1 admission and a reopened complete known registration artifact', async () => {
  await host!.resetAdmission();
  await host!.setProviderScenario('ok');
  const before = await host!.inspect();
  const lookup = await openLookup();
  try {
    expect(await lookup.page.getByText(/domain.*Wyreup.*public.*registry/i).count()).toBeGreaterThan(0);
    const response = await calculate(lookup.page);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['content-type']).toContain('application/json');
    const headers = await response.request().allHeaders();
    expect(headers.origin).toBe(host!.url);
    expect(headers.cookie).toBeUndefined();
    expect(headers.referer).toBeUndefined();
    expect(response.request().postDataJSON()).toEqual({ domain: 'example.com' });
    const downloaded = lookup.page.waitForEvent('download');
    await lookup.page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const download = await downloaded;
    const artifactPath = join(evidenceDir, 'domain-known-registration.json');
    await download.saveAs(artifactPath);
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
      status: string; domain: string; registrationAt: string; observedAt: string;
      ageDays: number; provider: string; sourceURL: string;
    };
    expect(artifact.status).toBe('ok');
    expect(artifact.domain).toBe('example.com');
    expect(artifact.registrationAt).toBe('2020-01-01T00:00:00Z');
    expect(artifact.provider).toBe('rdap.verisign.com');
    expect(artifact.sourceURL).toBe('https://rdap.verisign.com/com/v1/domain/example.com');
    const after = await host!.inspect();
    const observed = Date.parse(artifact.observedAt);
    expect(observed).toBeGreaterThanOrEqual(before.clock.now_seconds * 1000);
    expect(observed).toBeLessThan((after.clock.now_seconds + 1) * 1000);
    expect(artifact.ageDays).toBe(Math.floor((observed - Date.UTC(2020, 0, 1)) / 86400000));
    expect(after.leaseCount).toBe(0);
    expect(after.unexpectedOutbound).toBe(0);
    expect(after.counters).toHaveLength(2);
    expect(after.counters.every((counter) => counter.count === 1)).toBe(true);
    expect(after.counters.some((counter) => counter.scope_key.includes(after.expectedLoopbackDigest))).toBe(true);
    expect(after.requests.slice(before.requests.length).every((request) => request.headers.authorization === null && request.headers.cookie === null && request.headers.referer === null)).toBe(true);
    await writeFile(join(evidenceDir, 'domain-positive-inspection.json'), JSON.stringify({ before, after, requestHeaders: headers, artifact }, null, 2));
  } finally { await lookup.close(); }
}, 60000);

it('refuses an offline warm-page run without API, provider or counter work, then explicitly recovers', async () => {
  await host!.resetAdmission();
  const lookup = await openLookup();
  try {
    const before = await host!.inspect();
    await lookup.page.context().setOffline(true);
    await lookup.page.getByRole('button', { name: 'Calculate', exact: true }).click();
    await expect.poll(async () => lookup.page.getByRole('alert').count()).toBeGreaterThan(0);
    expect(lookup.requests).toHaveLength(0);
    const after = await host!.inspect();
    expect(after.outboundCalls).toBe(before.outboundCalls);
    expect(after.counters).toEqual(before.counters);
    expect(await lookup.page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(0);
    await lookup.page.context().setOffline(false);
    expect((await calculate(lookup.page)).status()).toBe(200);
    await lookup.page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
  } finally { await lookup.close(); }
}, 60000);

for (const scenario of ['provider-rate-limited', 'provider-error'] as const) {
  it(`reports ${scenario} from the actual handler and refuses a successful client artifact`, async () => {
    await host!.resetAdmission();
    await host!.setProviderScenario(scenario);
    const lookup = await openLookup();
    try {
      const response = await calculate(lookup.page);
      expect(response.status()).toBe(200);
      const data = await response.json() as { status: string };
      expect(data.status).toBe(scenario === 'provider-rate-limited' ? 'rate-limited' : 'provider-error');
      if (scenario === 'provider-rate-limited') expect(response.headers()['retry-after']).toBe('7');
      await expect.poll(async () => lookup.page.getByRole('alert').count()).toBeGreaterThan(0);
      expect(await lookup.page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(0);
      expect((await host!.inspect()).leaseCount).toBe(0);
    } finally { await lookup.close(); await host!.setProviderScenario('ok'); }
  }, 60000);
}

it('admits six real browser requests and rejects the seventh in the same measured D1 minute', async () => {
  await host!.resetAdmission();
  await host!.setProviderScenario('ok');
  const lookup = await openLookup();
  try {
    const before = await host!.inspect();
    for (let i = 0; i < 6; i++) {
      expect((await calculate(lookup.page)).status()).toBe(200);
      await lookup.page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
      await expect.poll(async () => lookup.page.getByRole('button', { name: 'Calculate', exact: true }).isEnabled()).toBe(true);
    }
    const seventh = await calculate(lookup.page);
    const after = await host!.inspect();
    expect(after.clock.window_start, 'A crossed minute is not evidence of the six-request limit.').toBe(before.clock.window_start);
    expect(seventh.status()).toBe(429);
    expect(after.counters.map((counter) => counter.count).sort()).toEqual([6, 6]);
    expect(after.leaseCount).toBe(0);
    await writeFile(join(evidenceDir, 'domain-rate-inspection.json'), JSON.stringify({ before, after }, null, 2));
  } finally { await lookup.close(); }
}, 60000);

for (const fault of ['missing-secret', 'missing-database'] as const) {
  it(`fails closed with ${fault} on the actual binding boundary`, () => {
    const operation = (async () => {
      requireOpen();
      const faultyOwner = own(startDomainFunctionsHost({ projectDir, distDir: fixture!.distDir, evidenceDir, expectedCoreDistPins: corePins, fault, deadlineAt: Date.now() + 180000 }));
      faultOwners.push(faultyOwner);
      const faulty = await faultyOwner.acquisition;
      let failed = false;
      let firstFailure: unknown;
      try {
        requireOpen();
        const lookup = await openLookup(faulty);
        try {
          expect((await calculate(lookup.page)).status()).toBe(503);
          await expect.poll(async () => lookup.page.getByRole('alert').count()).toBeGreaterThan(0);
          const inspection = await faulty.inspect();
          expect(inspection.outboundCalls).toBe(0);
          expect(inspection.leaseCount).toBe(0);
          expect(inspection.counters).toHaveLength(0);
        } finally { await lookup.close(); }
      } catch (reason) {
        failed = true;
        firstFailure = reason;
      }
      try { await closeOwned(faultyOwner); } catch (reason) {
        if (failed) {
          callbackCleanupErrors.push(reason);
        } else {
          failed = true;
          firstFailure = reason;
        }
      }
      if (failed) throw firstFailure;
    })();
    faultOperations.push(operation);
    return observe(operation);
  }, 180000);
}

it('rejects a native foreign-origin form POST before body parsing, admission or provider work', async () => {
  await host!.resetAdmission();
  requireOpen();
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<form method="post" action="${host!.url}/api/domain-age"><input name="domain" value="example.com"><button>Submit foreign form</button></form>`);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Owned foreign-origin server unavailable.');
  let page: Page | undefined;
  try {
    requireOpen();
    page = await browser!.newPage();
    requireOpen();
    const before = await host!.inspect();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const response = page.waitForResponse((value) => value.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit foreign form' }).click();
    expect((await response).status()).toBe(403);
    const after = await host!.inspect();
    expect(after.counters).toEqual(before.counters);
    expect(after.outboundCalls).toBe(before.outboundCalls);
    expect(after.leaseCount).toBe(0);
  } finally {
    await page?.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 60000);
