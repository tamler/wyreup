// Production discovery/privacy checks on actual owned builds and browser pages.
// Actual built Astro pages, package/default registry and production headers; no source alias.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';
import type * as PdfLib from '../../core/node_modules/pdf-lib/cjs/index.js';

// Runtime resolution is anchored to the real core dependency owner, not web.
const { PDFDocument } = createRequire(new URL('../../core/package.json', import.meta.url))('pdf-lib') as
  typeof PdfLib;

let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let server: Awaited<ReturnType<typeof serveBuiltCatalog>> | undefined;
let browser: Browser | undefined;
let evidenceDir: string;
let setupFailed = false;
let setupFailure: unknown;
let setupController: AbortController | undefined;
let setupTimer: ReturnType<typeof setTimeout> | undefined;
let cleanupStarted = false;
let browserClose: Promise<void> | undefined;
let serverClose: Promise<void> | undefined;
const pending: Array<{ label: string; settled: Promise<PromiseSettledResult<unknown>> }> = [];

function closeBrowser(): Promise<void> {
  return browser ? browserClose ??= browser.close() : Promise.resolve();
}

function closeServer(): Promise<void> {
  return server ? serverClose ??= server.close() : Promise.resolve();
}

function own<T>(label: string, operation: Promise<T>, capture: (value: T) => void, closeLate?: () => Promise<void>): Promise<T> {
  const captured = operation.then(async (value) => {
    capture(value);
    // Even a late launch result is owned and stopped after cleanup starts.
    if (cleanupStarted && closeLate) await closeLate();
    return value;
  });
  const settled = captured.then<PromiseSettledResult<unknown>, PromiseSettledResult<unknown>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
  pending.push({ label, settled });
  return captured;
}

function setupActive() {
  if (!setupController || setupController.signal.aborted || cleanupStarted)
    throw setupController?.signal.reason ?? new Error('Production setup lifetime ended.');
}

function bounded<T>(operation: () => Promise<T>, phaseBudget: number, deadlineAt: number, label: string): Promise<T> {
  const milliseconds = Math.min(phaseBudget, deadlineAt - Date.now());
  if (milliseconds <= 0)
    return Promise.reject(new Error(`${label} was not started because the absolute 90000ms cleanup lifetime ended; evidence ${evidenceDir ?? 'not yet established'}; owned artifacts remain uncertified.`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not settle within ${milliseconds}ms; evidence ${evidenceDir ?? 'not yet established'}; no cleanup success claimed.`)), milliseconds);
    let pendingOperation: Promise<T>;
    try { pendingOperation = operation(); }
    catch (error) {
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve the exact native reason, including non-Error values.
      reject(error);
      return;
    }
    pendingOperation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (reason: unknown) => {
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve the exact native reason, including non-Error values.
        reject(reason);
      },
    );
  });
}

beforeAll(async () => {
  const started = Date.now();
  const setupDeadline = started + 230000;
  setupController = new AbortController();
  setupTimer = setTimeout(() => setupController?.abort(new Error('Production setup exceeded its absolute 230000ms deadline.')), Math.max(0, setupDeadline - Date.now()));
  try {
    setupActive();
    await own('evidence directory', mkdtemp(join(tmpdir(), 'wyreup-discovery-privacy-')), (value) => { evidenceDir = value; });
    setupActive();
    console.info(`Discovery/privacy owned evidence: ${evidenceDir}`);
    await own('guarded fixture build', buildProductionCatalogFixture({
      webDir: fileURLToPath(new URL('..', import.meta.url)),
      evidenceDir,
      callerAbortSignal: setupController.signal,
      deadlineAt: setupDeadline,
    }), (value) => { fixture = value; });
    setupActive();
    if (!fixture) throw new Error('Guarded fixture handle is missing.');
    console.info(`Discovery/privacy manifest: ${fixture.manifest}; dist: ${fixture.distDir}`);
    await own('static host startup', serveBuiltCatalog({
      distDir: fixture.distDir,
      headersFile: join(fixture.distDir, '_headers'),
      callerAbortSignal: setupController.signal,
      // Runtime host lifetime is independent of the setup deadline.
      deadlineAt: Date.now() + 300000,
    }), (value) => { server = value; }, closeServer);
    setupActive();
    await own('Chromium launch', chromium.launch({ headless: true, timeout: 10000 }), (value) => { browser = value; }, closeBrowser);
    setupActive();
    clearTimeout(setupTimer);
  } catch (error) {
    setupFailed = true;
    setupFailure = error;
    setupController.abort(error);
    throw error;
  }
}, 240000);

afterAll(async () => {
  const cleanupDeadline = Date.now() + 90000;
  cleanupStarted = true;
  clearTimeout(setupTimer);
  setupController?.abort(new Error('Owned production acceptance is closing.'));
  const failures: unknown[] = setupFailed ? [setupFailure] : [];
  let settled = false;
  let stopped = false;
  try {
    const results = await bounded(() => Promise.all(pending.map((entry) => entry.settled)), 30000, cleanupDeadline, 'Pending setup ownership');
    settled = true;
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected' && result.reason !== setupFailure) {
        const reason: unknown = result.reason;
        failures.push(new Error(`${pending[index].label} failed.`, { cause: reason }));
      }
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    const results = await bounded(() => Promise.allSettled([closeBrowser(), closeServer()]), 20000, cleanupDeadline, 'Owned browser/host shutdown');
    stopped = results.every((result) => result.status === 'fulfilled');
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        failures.push(reason);
      }
    }
  } catch (error) {
    failures.push(error);
  }
  // Never remove the copied tree while a launch or its readers remain unsettled.
  if (settled && stopped) {
    try { await bounded(() => fixture?.close() ?? Promise.resolve(), 30000, cleanupDeadline, 'Owned fixture removal'); }
    catch (error) { failures.push(error); }
  } else {
    failures.push(new Error(`Owned build tree retained because setup or readers did not settle; evidence ${evidenceDir ?? 'not yet established'}; manifest ${fixture?.manifest ?? 'not returned'}. Helper failure causes preserve owned PID/tree diagnostics.`));
  }
  if (failures.length)
    throw new AggregateError(failures, 'Owned discovery/privacy setup or cleanup failed.');
  // Phase ceilings: 30s pending, 20s concurrent readers, 30s removal; 10s reporting reserve.
  // Every wait is also capped by the same absolute 90s deadline; no phase renews it.
  // Timeouts retain late promise handlers and do not forcibly cancel filesystem work.
  // Removal begins only after setup and reader settlement; partial removal can finish late.
}, 90000);

async function withPage(action: (page: Page) => Promise<void>) {
  if (!browser || !server) throw new Error('Production setup did not complete.');
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const failures: unknown[] = [];
  try {
    // These checks need no external providers, model downloads or paid processing.
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.origin === server!.url ? route.continue() : route.abort('blockedbyclient')
        : route.continue();
    });
    await action(page);
  } catch (error) {
    failures.push(error);
  } finally {
    try { await context.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Production page assertions or owned context cleanup failed.');
}

async function openRealPage(page: Page, path: string) {
  if (!server) throw new Error('Production host is absent.');
  const response = await page.goto(server.url + path);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-security-policy']).toBeTruthy();
  await page.getByRole('heading', { level: 1 }).waitFor();
  await expect.poll(() => page.locator('astro-island[ssr]').count(), { timeout: 10000 }).toBe(0);
  expect(await page.getByText(/runner (is )?unavailable|not mapped/i).count()).toBe(0);
}

async function costText(page: Page) {
  const row = page.locator('.tool-facts__row').filter({ has: page.locator('dt', { hasText: /^Cost$/ }) });
  expect(await row.count()).toBe(1);
  return (await row.locator('dd').innerText()).replace(/\s+/g, ' ');
}

it('the actual domain Cost and Privacy blocks describe free network processing', async () => {
  await withPage(async (page) => {
    const api: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/domain-age') api.push(request.method());
    });
    await openRealPage(page, '/tools/domain-age-checker/');
    const cost = await costText(page);
    expect(cost).toMatch(/free/i);
    expect(cost).toMatch(/network|lookup/i);
    expect(cost).not.toMatch(/runs in your browser|local(?:ly)?|on your device/i);
    const privacy = page.locator('.privacy-callout');
    const text = await privacy.innerText();
    expect(text).toMatch(/domain.*(?:sent|sends).*Wyreup/i);
    expect(text).toMatch(/registration registry|public.*registry|RDAP/i);
    expect(text).toMatch(/IANA.*bootstrap/i);
    expect(text).toMatch(/no (?:account or )?API key|no account.*API key/i);
    expect(text).toMatch(/connection|network/i);
    expect(text).not.toMatch(/executes in your browser|runs in your browser|processing.*locally/i);
    expect(await privacy.getByRole('link', { name: /privacy policy/i }).getAttribute('href')).toBe('/legal/privacy');
    await page.getByRole('textbox', { name: /domain/i }).waitFor();
    expect(api).toEqual([]);
  });
}, 30000);

it('retains separate actual local and hosted facts without running the hosted tool', async () => {
  await withPage(async (page) => {
    await openRealPage(page, '/tools/compress/');
    expect(await costText(page)).toMatch(/free/i);
    const local = await page.locator('.privacy-callout').innerText();
    expect(local).toMatch(/local|in (?:this|your) browser/i);
    expect(local).toMatch(/setup|download/i);
    expect(local).not.toMatch(/domain.*sent.*Wyreup/i);
    await openRealPage(page, '/tools/analyze-chart/');
    expect(await costText(page)).toMatch(/credit/i);
    const hosted = await page.locator('.privacy-callout').innerText();
    expect(hosted).toMatch(/hosted.*PRO/i);
    expect(hosted).toMatch(/input.*sent.*Wyreup/i);
    expect(hosted).toMatch(/model provider/i);
    expect(await page.locator('.privacy-callout').getByRole('link', { name: /privacy policy/i }).getAttribute('href')).toBe('/legal/privacy');
  });
}, 45000);

it('qualifies the real tools OG description and local/hosted category notices', async () => {
  await withPage(async (page) => {
    await openRealPage(page, '/tools/');
    const description = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(description).toMatch(/local/i);
    expect(description).toMatch(/network/i);
    expect(description).toMatch(/hosted/i);
    expect(description).not.toMatch(/free tools (?:run|execute).*on your device/i);
    for (const category of ['finance', 'dev']) {
      await openRealPage(page, `/category/${category}/`);
      const note = await page.locator('.cat-intro__para').last().innerText();
      expect(note).toMatch(/check|requirement|needed|explain/i);
      expect(note).not.toMatch(/(?:all|every|free) tools (?:run|execute).*?(?:locally|in your browser|on your device)/i);
      if (category === 'dev') {
        expect(note).toMatch(/includes network lookups/i);
        expect(note).toMatch(/connection/i);
      } else {
        expect(note).not.toMatch(/includes network lookups/i);
      }
    }
  });
}, 45000);

it('shows a qualified offline banner on a hydrated real page and clears it online', async () => {
  await withPage(async (page) => {
    await openRealPage(page, '/tools/domain-age-checker/');
    const api: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/domain-age') api.push(request.method());
    });
    await page.context().setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const banner = page.locator('.pwa-banner--offline');
    await banner.waitFor();
    const text = await banner.innerText();
    expect(text).toMatch(/local/i);
    expect(text).toMatch(/asset/i);
    expect(text).toMatch(/if|when|available/i);
    expect(text).toMatch(/network/i);
    expect(text).toMatch(/hosted|PRO/i);
    expect(text).toMatch(/connection|internet|online/i);
    expect(text).not.toMatch(/cached tools still work/i);
    expect(api).toEqual([]);
    await page.context().setOffline(false);
    await expect.poll(() => banner.count()).toBe(0);
  });
}, 30000);

it('qualifies actual face-blur asset availability while preserving notice dismissal', async () => {
  await withPage(async (page) => {
    await openRealPage(page, '/tools/face-blur/');
    const notice = page.locator('.dl-notice');
    await notice.waitFor();
    const text = await notice.innerText();
    expect(text).toMatch(/first run downloads/i);
    expect(text).toMatch(/asset|model/i);
    expect(text).toMatch(/offline/i);
    expect(text).toMatch(/if|when|depend/i);
    expect(text).not.toMatch(/then runs offline/i);
    await notice.getByRole('button', { name: 'Dismiss download notice', exact: true }).click();
    await expect.poll(() => notice.count()).toBe(0);
  });
}, 30000);

it('admits exact parameterized PDF MIME on the real runner and reopens its complete metadata artifact', async () => {
  // Independent benign fixture: one known page and author-controlled stable metadata.
  const document = await PDFDocument.create();
  document.addPage([200, 300]);
  document.setTitle('Direct admission oracle');
  document.setAuthor('Local fixture author');
  document.setSubject('MIME parameter admission');
  document.setCreator('Independent test fixture');
  document.setCreationDate(new Date('2020-01-02T03:04:05Z'));
  const bytes = await document.save();
  await withPage(async (page) => {
    await openRealPage(page, '/tools/pdf-info/');
    const button = page.getByRole('button', { name: 'Inspect PDF', exact: true });
    expect(await button.isEnabled()).toBe(false);
    const zone = page.getByRole('button', { name: 'Drop file or click to browse', exact: true });
    const wrong = await page.evaluateHandle((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], 'wrong.pdf', { type: 'image/png' }));
      return transfer;
    }, [...bytes]);
    await zone.dispatchEvent('drop', { dataTransfer: wrong });
    await wrong.dispose();
    expect(await button.isEnabled()).toBe(false);
    await page.getByText('File type not accepted. Expected: application/pdf', { exact: true }).waitFor();
    const transfer = await page.evaluateHandle((data) => {
      const selected = new DataTransfer();
      selected.items.add(new File([new Uint8Array(data)], 'original.pdf', { type: 'application/pdf;profile=test' }));
      return selected;
    }, [...bytes]);
    await zone.dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
    await expect.poll(() => button.isEnabled()).toBe(true);
    const started = Date.now();
    await button.click();
    await page.getByRole('button', { name: 'Inspect again', exact: true }).waitFor();
    const finished = Date.now();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const downloaded = await pending;
    const path = join(evidenceDir, 'parameterized-pdf-info.json');
    await downloaded.saveAs(path);
    const artifact: unknown = JSON.parse((await readFile(path)).toString('utf8'));
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new Error('Metadata output is not an object.');
    expect(Object.keys(artifact).sort()).toEqual([
      'author', 'bytes', 'createdAt', 'creator', 'modifiedAt', 'pageCount', 'producer', 'subject', 'title',
    ]);
    expect(artifact).toMatchObject({
      pageCount: 1,
      bytes: bytes.length,
      title: 'Direct admission oracle',
      author: 'Local fixture author',
      subject: 'MIME parameter admission',
      creator: 'Independent test fixture',
      createdAt: '2020-01-02T03:04:05.000Z',
      producer: 'pdf-lib (https://github.com/Hopding/pdf-lib)',
    });
    // Installed PDFDocument.load updates ModificationDate to read time; preserve that authority.
    if (!('modifiedAt' in artifact) || typeof artifact.modifiedAt !== 'string') throw new Error('Modification timestamp is missing.');
    const modified = Date.parse(artifact.modifiedAt);
    expect(Number.isFinite(modified)).toBe(true);
    expect(modified).toBeGreaterThanOrEqual(Math.floor(started / 1000) * 1000);
    expect(modified).toBeLessThanOrEqual(finished);
  });
}, 60000);
