// Additive genuine intake/live-text controls. Original seven production files remain unchanged.
// Native IndexedDB completion holds below are explicitly controlled timing seams, not tool jobs.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';

declare global {
  interface Window {
    source7GenuinePreviewURLs: {
      rows: Array<{ url: string; blob: Blob; name: string | null; bytes: number; type: string; revoked: boolean }>;
      retained: File | null;
    };
  }
}

let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let server: Awaited<ReturnType<typeof serveBuiltCatalog>> | undefined;
let browser: Browser | undefined;
let evidenceDir: string;
let setupController: AbortController | undefined;
let setupTimer: ReturnType<typeof setTimeout> | undefined;
let closing = false;
let browserClosing: Promise<void> | undefined;
let serverClosing: Promise<void> | undefined;
const pending: Array<Promise<PromiseSettledResult<unknown>>> = [];
const observations: Array<Record<string, unknown>> = [];

function closeBrowser() { return browser ? browserClosing ??= browser.close() : Promise.resolve(); }
function closeServer() { return server ? serverClosing ??= server.close() : Promise.resolve(); }
function own<T>(operation: Promise<T>, capture: (value: T) => void, closeLate?: () => Promise<void>) {
  const result = operation.then(async value => { capture(value); if (closing && closeLate) await closeLate(); return value; });
  pending.push(result.then<PromiseSettledResult<unknown>, PromiseSettledResult<unknown>>(
    value => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason }),
  ));
  return result;
}
function bounded<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' did not settle; owned artifacts retained.')), milliseconds);
    operation.then(value => { clearTimeout(timer); resolve(value); }, reason => {
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve actual owned failure identity.
      reject(reason);
    });
  });
}

beforeAll(async () => {
  setupController = new AbortController();
  const deadlineAt = Date.now() + 230000;
  setupTimer = setTimeout(() => setupController?.abort(new Error('Runner fixture setup deadline.')), 230000);
  try {
    await own(mkdtemp(join(tmpdir(), 'wyreup-runner-intake-')), value => { evidenceDir = value; });
    await own(buildProductionCatalogFixture({
      webDir: fileURLToPath(new URL('..', import.meta.url)), evidenceDir,
      callerAbortSignal: setupController.signal, deadlineAt,
    }), value => { fixture = value; });
    if (!fixture || setupController.signal.aborted) throw new Error('Owned fixture did not become current.');
    await own(serveBuiltCatalog({
      distDir: fixture.distDir, headersFile: join(fixture.distDir, '_headers'),
      callerAbortSignal: setupController.signal, deadlineAt: Date.now() + 600000,
    }), value => { server = value; }, closeServer);
    await own(chromium.launch({ headless: true, timeout: 10000 }), value => { browser = value; }, closeBrowser);
    if (setupController.signal.aborted || closing) throw new Error('Owned setup lifetime ended.');
    clearTimeout(setupTimer);
  } catch (error) {
    setupController.abort(error);
    throw error;
  }
}, 240000);

afterAll(async () => {
  closing = true;
  clearTimeout(setupTimer);
  setupController?.abort(new Error('Owned runner suite is closing.'));
  const deadline = Date.now() + 90000;
  const failures: unknown[] = [];
  let settled = false, stopped = false;
  try {
    const results = await bounded(Promise.all(pending), Math.min(30000, deadline - Date.now()), 'Setup ownership');
    settled = true;
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
  } catch (error) { failures.push(error); }
  try {
    const results = await bounded(Promise.allSettled([closeBrowser(), closeServer()]), Math.min(20000, Math.max(1, deadline - Date.now())), 'Browser/server close');
    stopped = results.every(result => result.status === 'fulfilled');
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
  } catch (error) { failures.push(error); }
  if (evidenceDir) {
    try { await bounded(writeFile(join(evidenceDir, 'runner-intake-observations.json'), JSON.stringify(observations, null, 2)), Math.max(1, deadline - Date.now()), 'Observation write'); }
    catch (error) { failures.push(error); }
  }
  if (settled && stopped) {
    try { await bounded(fixture?.close() ?? Promise.resolve(), Math.min(30000, Math.max(1, deadline - Date.now())), 'Fixture close'); }
    catch (error) { failures.push(error); }
  } else failures.push(new Error('Owned fixture retained: acquisition/readers are unresolved.'));
  if (failures.length) throw new AggregateError(failures, 'Runner acceptance setup or cleanup failed.');
}, 90000);

async function pageCase(action: (page: Page) => Promise<void>) {
  if (!browser || !server) throw new Error('Owned setup missing.');
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: unknown[] = [];
  page.on('pageerror', error => { errors.push(error); });
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) && url.origin !== server!.url
        ? route.abort('blockedbyclient') : route.continue();
    });
    await action(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}
async function catalog(page: Page, id: string) {
  const response = await page.goto(server!.url + '/acceptance/catalog/?tool=' + id);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-security-policy']).toBeTruthy();
  await page.locator('[data-ready="true"]').waitFor();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
}
async function direct(page: Page, id: string) {
  const response = await page.goto(server!.url + '/tools/' + id + '/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-security-policy']).toBeTruthy();
  await page.getByRole('textbox', { name: 'Input text', exact: true }).waitFor();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
}
async function pick(page: Page, name: string, mimeType: string, text: string) {
  await page.getByLabel('Parent input file', { exact: true }).setInputFiles({ name, mimeType, buffer: Buffer.from(text) });
}
async function mount(page: Page) {
  await page.getByRole('button', { name: 'Mount / remount target', exact: true }).click();
}
async function download(page: Page, button: string, label: string) {
  const [artifact] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button, exact: true }).click(),
  ]);
  const destination = join(evidenceDir, label);
  await artifact.saveAs(destination);
  const bytes = await readFile(destination);
  observations.push({ kind: 'actual-download', label, name: artifact.suggestedFilename(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return { bytes, name: artifact.suggestedFilename() };
}
async function pendingRecord(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wyreup', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Native pending-record open failed.'));
    });
    try {
      const tx = db.transaction('chain-input', 'readonly');
      const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Native pending-record read failed.')); });
      const request = tx.objectStore('chain-input').get('pending');
      const value = await new Promise<unknown>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Native pending-record request failed.')); });
      await complete;
      if (!value) return null;
      const record = value as { token: string; name: string; type: string; blob: Blob; autoAccept?: boolean; targetToolId?: string };
      return { token: record.token, name: record.name, type: record.type, text: await record.blob.text(), autoAccept: record.autoAccept, targetToolId: record.targetToolId };
    } finally { db.close(); }
  });
}
async function replacement(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wyreup', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Independent writer open failed.'));
    });
    try {
      const tx = db.transaction('chain-input', 'readwrite');
      const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Independent writer failed.')); });
      tx.objectStore('chain-input').put({
        token: 'independent-replacement-token', name: 'replacement.txt', type: 'text/plain',
        blob: new File(['independent replacement bytes'], 'replacement.txt', { type: 'text/plain' }),
        autoAccept: false, targetToolId: 'word-counter',
      }, 'pending');
      await complete;
    } finally { db.close(); }
  });
}
interface CompletionProbe { committed: boolean; released: boolean; operations: string[]; release(): void }
async function holdNativeCompletion(page: Page, selected: 'delete' | 'put') {
  await page.evaluate(operation => {
    const transactions = new WeakSet<IDBTransaction>();
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    if (!descriptor?.set || !descriptor.get) throw new Error('Native transaction completion accessor absent.');
    type NativeTransaction = (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) => ReturnType<IDBDatabase['transaction']>;
    type NativeDelete = (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) => ReturnType<IDBObjectStore['delete']>;
    type NativePut = (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) => ReturnType<IDBObjectStore['put']>;
    const transaction = (IDBDatabase.prototype as { transaction: NativeTransaction }).transaction;
    const mutate = operation === 'delete'
      ? (IDBObjectStore.prototype as { delete: NativeDelete }).delete
      : (IDBObjectStore.prototype as { put: NativePut }).put;
    const probe = { committed: false, released: false, operations: [] as string[], release: () => {} };
    Object.assign(window, { runnerCompletionProbe: probe });
    let armed = true;
    const relevant = (store: IDBObjectStore) => store.name === 'chain-input' && store.transaction.db.name === 'wyreup';
    if (operation === 'delete') {
      IDBObjectStore.prototype.delete = function (key) {
        const result = (mutate as typeof IDBObjectStore.prototype.delete).call(this, key);
        if (relevant(this) && key === 'pending') { transactions.add(this.transaction); probe.operations.push('native-delete'); }
        return result;
      };
    } else {
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        const result = (mutate as typeof IDBObjectStore.prototype.put).call(this, value, key);
        if (relevant(this) && key === 'pending') { transactions.add(this.transaction); probe.operations.push('native-put'); }
        return result;
      };
    }
    IDBDatabase.prototype.transaction = function (names, mode?, options?) {
      const tx = transaction.call(this, typeof names === 'string' ? names : Array.from(names), mode, options);
      if (this.name !== 'wyreup' || mode !== 'readwrite') return tx;
      Object.defineProperty(tx, 'oncomplete', {
        configurable: true,
        get: () => descriptor.get!.call(tx) as IDBTransaction['oncomplete'],
        set(listener: IDBTransaction['oncomplete']) {
          descriptor.set!.call(tx, (event: Event) => {
            if (armed && transactions.has(tx) && listener) {
              armed = false; probe.committed = true;
              probe.release = () => { if (probe.released) throw new Error('Completion released twice.'); probe.released = true; listener.call(tx, event); };
            } else listener?.call(tx, event);
          });
        },
      });
      return tx;
    };
  }, selected);
}
async function waitCommitted(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { runnerCompletionProbe: CompletionProbe }).runnerCompletionProbe.committed)).toBe(true);
}
async function releaseCompletion(page: Page) {
  const before = await page.evaluate(() => {
    const probe = (window as unknown as { runnerCompletionProbe: CompletionProbe }).runnerCompletionProbe;
    const snapshot = { committed: probe.committed, released: probe.released, operations: [...probe.operations] };
    probe.release(); return snapshot;
  });
  observations.push({ kind: 'controlled-native-IDB-completion', ...before });
}
async function liveDone(page: Page) { await page.getByRole('region', { name: 'Live result', exact: true }).waitFor(); }

it.each(['wrong MIME', 'just over 20 MiB'] as const)('the genuine image additional picker refuses %s before preview while retaining its first File', async mode => {
  await pageCase(async page => {
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      const probe: Window['source7GenuinePreviewURLs'] = { rows: [], retained: null };
      window.source7GenuinePreviewURLs = probe;
      URL.createObjectURL = function (value) {
        const url = create(value);
        if (value instanceof Blob) probe.rows.push({ url, blob: value, name: value instanceof File ? value.name : null, bytes: value.size, type: value.type, revoked: false });
        return url;
      };
      URL.revokeObjectURL = function (url) {
        revoke(url);
        for (const row of probe.rows) if (row.url === url) row.revoked = true;
      };
    });
    await catalog(page, 'image-similarity');
    const original = Buffer.from('source7 genuine picker original bytes');
    await page.getByLabel('Parent input file', { exact: true }).setInputFiles({ name: 'kept-original.png', mimeType: 'image/png', buffer: original });
    await page.getByRole('button', { name: 'Deliver selected File', exact: true }).click();
    await mount(page);
    await page.getByRole('img', { name: 'kept-original.png', exact: true }).waitFor();
    const initial = await page.getByRole('img', { name: 'kept-original.png', exact: true }).evaluate(image => {
      if (!(image instanceof HTMLImageElement)) throw new Error('Actual preview image missing.');
      const probe = window.source7GenuinePreviewURLs;
      const matches = probe.rows.filter(row => row.url === image.src);
      if (matches.length !== 1) throw new Error('Expected exactly one actual native preview URL creation.');
      const row = matches[0];
      if (!(row.blob instanceof File)) throw new Error('Actual native preview File missing.');
      probe.retained = row.blob;
      return { url: image.src, name: row.name, bytes: row.bytes, type: row.type, revoked: row.revoked };
    });
    expect(initial.name).toBe('kept-original.png'); expect(initial.bytes).toBe(original.length);
    expect(initial.type).toBe('image/png'); expect(initial.revoked).toBe(false);
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add more', exact: true }).click();
    await (await choosing).setFiles({ name: 'refused-additional.png', mimeType: mode === 'wrong MIME' ? 'text/plain' : 'image/png', buffer: mode === 'wrong MIME' ? Buffer.from('not an image') : Buffer.alloc(20 * 1024 * 1024 + 1) });
    await page.getByText(/too large|size limit|not accepted|unsupported|cannot import|not interpreted/i).first().waitFor();
    expect(await page.getByRole('img', { name: 'refused-additional.png', exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => window.source7GenuinePreviewURLs.rows.filter(row => row.name === 'refused-additional.png'))).toEqual([]);
    expect(await page.getByRole('button', { name: 'Compare images', exact: true }).isDisabled()).toBe(true);
    const retained = await page.getByRole('img', { name: 'kept-original.png', exact: true }).evaluate(async (image, originalURL) => {
      if (!(image instanceof HTMLImageElement) || image.src !== originalURL) throw new Error('Actual original preview URL changed.');
      const probe = window.source7GenuinePreviewURLs;
      const matches = probe.rows.filter(row => row.url === image.src);
      if (matches.length !== 1) throw new Error('Actual native preview URL association changed.');
      const row = matches[0];
      if (!(row.blob instanceof File) || row.blob !== probe.retained || row.revoked)
        throw new Error('Actual original preview File identity or revocation changed.');
      return Array.from(new Uint8Array(await row.blob.arrayBuffer()));
    }, initial.url);
    expect(Buffer.from(retained)).toEqual(original);
  });
}, 60000);
async function manualDone(page: Page, text = '{"marker":"committed-original"}') {
  await page.getByRole('button', { name: 'Manual/file', exact: true }).click();
  await page.getByRole('textbox', { name: 'Input text', exact: true }).fill(text);
  await page.getByRole('button', { name: /^Run / }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
  await page.locator('.chain-nodes .chain-node').first().waitFor();
}

it('consumes one real CSV intake token across repeated Load and delimiter changes', async () => {
  await pageCase(async page => {
    await catalog(page, 'csv-viewer');
    await pick(page, 'intake.csv', 'text/csv', 'name,value\nfirst,7\nsecond,8\n');
    await page.getByRole('button', { name: 'Stash File for selected canonical tool', exact: true }).click();
    await expect.poll(() => page.locator('[data-fixture-status]').textContent()).toContain('Stored intake.csv');
    await mount(page);
    await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
    await page.getByText('2 data rows, 2 columns. Values remain text.', { exact: true }).waitFor();
    await expect.poll(() => pendingRecord(page)).toBeNull();
    const first = await download(page, 'Download CSV', 'csv-first.csv');
    await page.getByRole('combobox', { name: 'Input delimiter', exact: true }).selectOption('comma');
    await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
    await page.getByText('2 data rows, 2 columns. Values remain text.', { exact: true }).waitFor();
    expect((await download(page, 'Download CSV', 'csv-repeat.csv')).bytes).toEqual(first.bytes);
    expect(await page.locator('.chain-banner').count()).toBe(0);
    expect(await pendingRecord(page)).toBeNull();
  });
}, 60000);

it('Dismiss after a refused real seating preload preserves manually entered guests and exact saved bytes', async () => {
  await pageCase(async page => {
    await catalog(page, 'wedding-seating-chart-builder');
    await pick(page, 'bad-plan.json', 'application/json', '{"not":"a seating plan"}');
    await page.getByRole('button', { name: 'Deliver selected File', exact: true }).click(); await mount(page);
    await page.getByText('Seating plan was not restored.', { exact: true }).waitFor();
    await page.getByLabel('New guest name', { exact: true }).fill('Independent Guest');
    await page.getByRole('button', { name: 'Add guest', exact: true }).click();
    const before = await download(page, 'Save plan JSON', 'seating-before.json');
    await page.locator('.chain-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
    expect(await page.locator('.chain-banner').count()).toBe(0);
    expect((await download(page, 'Save plan JSON', 'seating-after.json')).bytes).toEqual(before.bytes);
  });
}, 60000);

it('Dismiss preserves the actual mounted running stopwatch and accumulated lap state', async () => {
  await pageCase(async page => {
    await catalog(page, 'stopwatch');
    await pick(page, 'bad-timer.json', 'application/json', '{"not":"a timer"}');
    await page.getByRole('button', { name: 'Deliver selected File', exact: true }).click(); await mount(page);
    await page.getByText('Timer session was not restored.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByText('State: running', { exact: true }).waitFor();
    await expect.poll(() => page.getByLabel('Elapsed time', { exact: true }).textContent()).not.toBe('00:00.000');
    await page.getByRole('button', { name: 'Lap', exact: true }).click();
    await page.evaluate(() => Object.assign(window, { originalTimerNode: document.querySelector('.timer') }));
    await page.locator('.chain-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { originalTimerNode: Element }).originalTimerNode === document.querySelector('.timer'))).toBe(true);
    await page.getByText('State: running', { exact: true }).waitFor();
    expect(await page.getByRole('table', { name: 'Recorded laps', exact: true }).locator('tbody tr').count()).toBe(1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const saved = JSON.parse((await download(page, 'Save session JSON', 'stopwatch-dismiss.json')).bytes.toString('utf8')) as { elapsedMs: number; laps: unknown[] };
    expect(saved.elapsedMs).toBeGreaterThan(0); expect(saved.laps).toHaveLength(1);
  });
}, 60000);

it('Dismiss preserves a manually selected replacement CSV in the existing runner', async () => {
  await pageCase(async page => {
    await catalog(page, 'csv-viewer');
    await pick(page, 'unsupported.bin', 'application/octet-stream', 'unsupported original');
    await page.getByRole('button', { name: 'Deliver selected File', exact: true }).click(); await mount(page);
    await page.locator('.chain-banner').waitFor();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.csv-viewer').getByRole('button', { name: 'Drop file or click to browse', exact: true }).click(),
    ]);
    await chooser.setFiles({ name: 'manual.csv', mimeType: 'text/csv', buffer: Buffer.from('name,value\nmanual,17\n') });
    await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
    await page.getByText('1 data rows, 2 columns. Values remain text.', { exact: true }).waitFor();
    const before = await download(page, 'Download CSV', 'manual-csv-before.csv');
    await page.locator('.chain-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
    expect((await download(page, 'Download CSV', 'manual-csv-after.csv')).bytes).toEqual(before.bytes);
  });
}, 60000);

it('records successful token consumption even when native completion arrives after an editor-mode change', async () => {
  await pageCase(async page => {
    await catalog(page, 'json-formatter');
    await pick(page, 'held.json', 'application/json', '{"marker":"same input"}');
    await page.getByRole('button', { name: 'Stash manual File', exact: true }).click();
    await expect.poll(() => page.locator('[data-fixture-status]').textContent()).toContain('Stored held.json'); await mount(page);
    await page.locator('.chain-banner').waitFor();
    await holdNativeCompletion(page, 'delete');
    await page.locator('.chain-banner').getByRole('button', { name: 'Use this file', exact: true }).click();
    await waitCommitted(page);
    expect(await pendingRecord(page)).toBeNull();
    await page.getByRole('button', { name: 'Manual/file', exact: true }).click();
    await expect.poll(() => page.getByRole('textbox', { name: 'Input text', exact: true }).inputValue()).toBe('{"marker":"same input"}');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
    await releaseCompletion(page);
    await expect.poll(() => page.locator('.chain-banner').count()).toBe(0);
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
    expect(JSON.parse((await download(page, 'Download', 'held-repeat.json')).bytes.toString('utf8'))).toEqual({ marker: 'same input' });
    expect(await page.locator('.chain-banner').count()).toBe(0);
  });
}, 60000);

it('a later editor remount does not redeliver a dismissed File identity', async () => {
  await pageCase(async page => {
    await catalog(page, 'json-formatter');
    await page.getByLabel('Parent input file', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from([0xff]) });
    await page.getByRole('button', { name: 'Deliver selected File', exact: true }).click(); await mount(page);
    await page.locator('.live-text-runner').getByRole('alert').filter({ hasText: /^Live input must be valid UTF-8\.$/ }).waitFor();
    await page.locator('.chain-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.getByRole('button', { name: 'Manual/file', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Input text', exact: true }).inputValue()).toBe('');
    expect(await page.getByText('Original file retained: invalid.json.', { exact: false }).count()).toBe(0);
    expect(await page.locator('.chain-banner').count()).toBe(0);
  });
}, 60000);

it.each([
  ['word-counter', 'json'],
  ['markdown-to-html', 'html'],
] as const)('the real empty %s output has identical automatic and manual/file download bytes', async (id, extension) => {
  await pageCase(async page => {
    await direct(page, id); await liveDone(page);
    const automatic = await download(page, 'Download result', id + '-empty-auto.' + extension);
    if (id === 'word-counter') expect(JSON.parse(automatic.bytes.toString('utf8'))).toMatchObject({ words: 0, characters: 0, utf8Bytes: 0 });
    else expect(automatic.bytes.toString('utf8')).toBe('<!doctype html><meta charset="utf-8">');
    await page.getByRole('button', { name: 'Manual/file', exact: true }).click();
    const run = page.getByRole('button', { name: /^Run / });
    expect(await run.isEnabled()).toBe(true);
    await run.click();
    const manual = await download(page, 'Download', id + '-empty-manual.' + extension);
    expect(manual.bytes).toEqual(automatic.bytes);
    expect(manual.name).toBe(automatic.name);
  });
}, 60000);

it('chains the actual prepared Markdown Blob/name/MIME without remote resources and clears the panel on edit', async () => {
  await pageCase(async page => {
    const remote: string[] = [];
    page.on('request', request => { if (request.url().startsWith('https://remote.invalid/')) remote.push(request.url()); });
    await catalog(page, 'markdown-to-html'); await mount(page);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill('# Safe\n![remote](https://remote.invalid/pixel.png)\n<script>window.invalidRunnerCanary=1</script>');
    await page.getByRole('heading', { name: 'Safe', exact: true }).waitFor();
    const output = await download(page, 'Download result', 'markdown-prepared.html');
    expect(output.name).toBe('markdown-to-html-result.html');
    expect(await page.getByRole('region', { name: 'Safe HTML preview', exact: true }).locator('img,script,[src],[onerror]').count()).toBe(0);
    await page.locator('.chain-nodes .chain-node').first().waitFor();
    await holdNativeCompletion(page, 'put');
    await page.locator('.chain-nodes .chain-node').first().click();
    await waitCommitted(page);
    const stored = await pendingRecord(page);
    expect(stored).not.toBeNull();
    expect(stored!.name).toBe(output.name); expect(stored!.type).toBe('text/html');
    expect(Buffer.from(stored!.text)).toEqual(output.bytes);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill('replacement edit');
    expect(await page.locator('.chain-section').count()).toBe(0);
    await releaseCompletion(page);
    await expect.poll(() => pendingRecord(page)).toBeNull();
    expect(remote).toEqual([]);
    expect(await page.evaluate(() => 'invalidRunnerCanary' in window)).toBe(false);
  });
}, 60000);

it('an already existing manual ChainSection compare-deletes its stale committed token after edit', async () => {
  await pageCase(async page => {
    await catalog(page, 'json-formatter'); await mount(page); await manualDone(page);
    await holdNativeCompletion(page, 'put');
    await page.locator('.chain-nodes .chain-node').first().click(); await waitCommitted(page);
    expect((await pendingRecord(page))?.autoAccept).toBe(true);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill('{"later":true}');
    await expect.poll(() => page.locator('.chain-section').count()).toBe(0);
    await releaseCompletion(page);
    await expect.poll(() => pendingRecord(page)).toBeNull();
    expect(new URL(page.url()).pathname).toBe('/acceptance/catalog/');
  });
}, 60000);

it('stale committed-token cleanup preserves an independently replaced native record', async () => {
  await pageCase(async page => {
    await catalog(page, 'json-formatter'); await mount(page); await manualDone(page);
    await holdNativeCompletion(page, 'put');
    await page.locator('.chain-nodes .chain-node').first().click(); await waitCommitted(page);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill('{"later":true}');
    await replacement(page);
    const before = await pendingRecord(page);
    await releaseCompletion(page);
    await expect.poll(() => pendingRecord(page)).toEqual(before);
    expect(before?.token).toBe('independent-replacement-token');
    expect(before?.text).toBe('independent replacement bytes');
    expect(new URL(page.url()).pathname).toBe('/acceptance/catalog/');
  });
}, 60000);

it.each(['overflow', 'write failure'] as const)('refuses continuity and compare-deletes only its committed token on trail %s', async mode => {
  await pageCase(async page => {
    await catalog(page, 'json-formatter'); await mount(page);
    if (mode === 'overflow') await manualDone(page, '{"marker":"initial-chain-result"}');
    await page.evaluate(selected => {
      if (selected === 'overflow') {
        sessionStorage.setItem('wyreup:hop-trail', JSON.stringify({
          steps: Array.from({ length: 20 }, () => ({ toolId: 'word-counter', params: {} })),
          token: 'prior-reviewed-trail-token', targetToolId: 'json-formatter',
        }));
      } else {
        type NativeSetItem = (this: Storage, ...args: Parameters<Storage['setItem']>) => ReturnType<Storage['setItem']>;
        const set = (Storage.prototype as { setItem: NativeSetItem }).setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === sessionStorage && key === 'wyreup:hop-trail') throw new DOMException('Controlled trail quota refusal.', 'QuotaExceededError');
          return set.call(this, key, value);
        };
      }
    }, mode);
    await manualDone(page);
    if (mode === 'overflow') await page.locator('.chain-save__copy').filter({ hasText: /^You chained 21 actions — each result fed the next\.$/ }).waitFor();
    const original = await download(page, 'Download', 'trail-' + mode.replace(' ', '-') + '.json');
    if (mode === 'overflow') {
      const handover = await page.evaluate(() => {
        const raw = sessionStorage.getItem('wyreup:hop-trail');
        return raw === null ? null : JSON.parse(raw) as unknown;
      });
      expect(handover).toEqual({
        steps: Array.from({ length: 20 }, () => ({ toolId: 'word-counter', params: {} })),
        token: 'prior-reviewed-trail-token', targetToolId: 'json-formatter',
      });
      observations.push({ kind: 'native-trail-before-next-tool', mode, record: handover });
    }
    const [copy] = await Promise.all([page.waitForEvent('download'), page.locator('.chain-nodes .chain-node').first().click()]);
    const copiedPath = join(evidenceDir, 'trail-refused-' + mode.replace(' ', '-') + '.json'); await copy.saveAs(copiedPath);
    expect(await readFile(copiedPath)).toEqual(original.bytes);
    await page.locator('.chain-notice').waitFor();
    await expect.poll(() => pendingRecord(page)).toBeNull();
    expect(new URL(page.url()).pathname).toBe('/acceptance/catalog/');
  });
}, 60000);

it('preserves empty-JSON refusal and invalidates a genuine live result after a new edit', async () => {
  await pageCase(async page => {
    await direct(page, 'json-formatter');
    expect(await page.getByRole('region', { name: 'Live result', exact: true }).count()).toBe(0);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill('{"real":true}');
    await liveDone(page);
    await page.getByRole('textbox', { name: 'Input text', exact: true }).fill(' ');
    await expect.poll(() => page.getByRole('region', { name: 'Live result', exact: true }).count()).toBe(0);
    expect(await page.locator('.chain-section').count()).toBe(0);
  });
}, 30000);
