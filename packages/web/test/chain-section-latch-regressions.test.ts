import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type * as FsPromisesApi from 'node:fs/promises';
import type { Page } from 'playwright';
import type * as StorageApi from '../src/components/runners/chainStorage';
import type * as TrailApi from '../src/components/runners/hopTrail';
import { openMediaCallerHarness } from './mediaCallerHarness';

const compileMutation = vi.hoisted(() => ({ enabled: false, selectedReads: 0, inverseExact: false, changedFinally: false }));
const chainSourcePath = fileURLToPath(new URL('../src/components/runners/ChainSection.svelte', import.meta.url));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesApi>();
  return {
    ...actual,
    async readFile(...args: unknown[]): Promise<unknown> {
      const pending: unknown = Reflect.apply(actual.readFile, undefined, args);
      if (!(pending instanceof Promise)) throw new Error('Actual fs readFile promise missing');
      const value: unknown = await pending;
      if (!compileMutation.enabled || args[0] !== chainSourcePath) return value;
      compileMutation.selectedReads++;
      if (compileMutation.selectedReads !== 1 || args[1] !== 'utf8' || typeof value !== 'string')
        throw new Error('Expected exactly one selected UTF8 compiler read');
      expect(Buffer.byteLength(value)).toBe(16640);
      expect(createHash('sha256').update(value).digest('hex')).toBe('3ef898b82813beb606e5cc03d1e2879c06e6f96b075090e52549aca6236e3098');
      const original = 'if (!locationAssigned) navigating = false;';
      const replacement = 'navigating = false;';
      const offset = value.indexOf(original);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(value.indexOf(original, offset + original.length)).toBe(-1);
      const candidate = value.slice(0, offset) + replacement + value.slice(offset + original.length);
      compileMutation.inverseExact = candidate.slice(0, offset) + original + candidate.slice(offset + replacement.length) === value;
      compileMutation.changedFinally = candidate.includes('} finally {\n      navigating = false;\n    }');
      expect(compileMutation.inverseExact).toBe(true);
      expect(compileMutation.changedFinally).toBe(true);
      return candidate;
    },
  };
});

declare global {
  interface Window {
    chainLatchProbe: { storage: typeof StorageApi; trail: typeof TrailApi };
    chainLatchControl: {
      armCompletion(ordinal: number): void;
      releaseIfHeld(): void;
      failTrailWrites(value: boolean): void;
      failFileOnce(): void;
      restoreFile(): void;
      status(): { completed: number; heldEvents: number; held: boolean; puts: number; opens: number; fileFaults: number };
    };
  }
}
let harness: Awaited<ReturnType<typeof openMediaCallerHarness>>;
beforeAll(async () => {
  harness = await openMediaCallerHarness('./test/fixtures/ChainSectionLatchHarness.svelte');
}, 30000);
afterAll(async () => { await harness?.close(); });

async function observeNativeBoundaries(page: Page) {
  await page.addInitScript(() => {
    const completion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    const put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
    const open = Object.getOwnPropertyDescriptor(IDBFactory.prototype, 'open');
    const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    const file = Object.getOwnPropertyDescriptor(window, 'File');
    const completionSetter: unknown = completion ? Reflect.get(completion, 'set') : undefined;
    const nativePut: unknown = put?.value;
    const nativeOpen: unknown = open?.value;
    const nativeSetItem: unknown = setItem?.value;
    const fileConstructor: unknown = file?.value;
    if (!file || typeof completionSetter !== 'function' || typeof nativePut !== 'function' || typeof nativeOpen !== 'function' ||
        typeof nativeSetItem !== 'function' || typeof fileConstructor !== 'function' || fileConstructor !== window.File)
      throw new Error('Native latch-control descriptors unavailable');
    const NativeFile = window.File;
    let remaining = 0, completed = 0, heldEvents = 0, puts = 0, opens = 0, fileFaults = 0;
    let trailFailure = false;
    let held: { transaction: IDBTransaction; callback: (this: IDBTransaction, event: Event) => unknown; event: Event } | null = null;
    function completionWrapper(transaction: IDBTransaction, callback: (this: IDBTransaction, event: Event) => unknown) {
      return function(this: IDBTransaction, event: Event) {
          if (transaction.db.name === 'wyreup' && transaction.mode === 'readwrite' && transaction.objectStoreNames.contains('chain-input')) {
            if (this !== transaction || event.target !== transaction) throw new Error('Native completion receiver/event changed');
            completed++;
            if (remaining > 0 && --remaining === 0) {
              if (held) throw new Error('Two owned completion callbacks held');
              held = { transaction, callback, event }; heldEvents++;
              return;
            }
          }
          callback.call(this, event);
      };
    }
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...completion,
      set(this: IDBTransaction, callback: ((this: IDBTransaction, event: Event) => unknown) | null) {
        Reflect.apply(completionSetter, this, [typeof callback === 'function' ? completionWrapper(this, callback) : callback]);
      },
    });
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      ...put,
      value(this: IDBObjectStore, ...args: unknown[]): unknown {
        const result: unknown = Reflect.apply(nativePut, this, args);
        if (!(result instanceof IDBRequest)) throw new Error('Actual native put request missing');
        if (this.transaction.db.name === 'wyreup' && this.name === 'chain-input' && args[1] === 'pending') puts++;
        return result;
      },
    });
    Object.defineProperty(IDBFactory.prototype, 'open', {
      ...open,
      value(this: IDBFactory, ...args: unknown[]): unknown {
        const result: unknown = Reflect.apply(nativeOpen, this, args);
        if (!(result instanceof IDBOpenDBRequest)) throw new Error('Actual native open request missing');
        if (args[0] === 'wyreup') opens++;
        return result;
      },
    });
    Object.defineProperty(Storage.prototype, 'setItem', {
      ...setItem,
      value(this: Storage, ...args: unknown[]): unknown {
        if (trailFailure && args[0] === 'wyreup:hop-trail') throw new DOMException('Controlled trail quota refusal', 'QuotaExceededError');
        const result: unknown = Reflect.apply(nativeSetItem, this, args);
        return result;
      },
    });
    window.chainLatchControl = {
      armCompletion(ordinal) {
        if (held || !Number.isSafeInteger(ordinal) || ordinal <= 0) throw new Error('Invalid owned completion arm');
        remaining = ordinal;
      },
      releaseIfHeld() {
        const actual = held;
        held = null;
        if (actual) actual.callback.call(actual.transaction, actual.event);
      },
      failTrailWrites(value) { trailFailure = value; },
      failFileOnce() {
        let armed = true;
        Object.defineProperty(window, 'File', { ...file, value: new Proxy(NativeFile, {
          construct(target, args, newTarget) {
            if (armed) { armed = false; fileFaults++; throw new Error('CONTROLLED_CHAIN_FILE_CONSTRUCTOR'); }
            const result: unknown = Reflect.construct(target, args, newTarget);
            if (!(result instanceof NativeFile)) throw new Error('Actual native File result missing');
            return result;
          },
        }) });
      },
      restoreFile() { Object.defineProperty(window, 'File', file); },
      status() { return { completed, heldEvents, held: held !== null, puts, opens, fileFaults }; },
    };
  });
}

type NavigationGate = {
  requests: string[];
  settle(): Promise<void>;
  remove(): Promise<void>;
  finished: Promise<void> | null;
};
async function holdOwnedNavigation(page: Page, origin: string): Promise<NavigationGate> {
  const requests: string[] = [];
  const records: Array<{ work: Promise<void>; status: { fulfilled: boolean; failure: { reason: unknown } | null } }> = [];
  let released = false;
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  const pattern = origin + '/tools/**';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    if (!route.request().isNavigationRequest()) { await route.continue(); return; }
    const url = new URL(route.request().url());
    expect(url.origin).toBe(origin); expect(url.pathname.startsWith('/tools/')).toBe(true);
    requests.push(url.href);
    const status: { fulfilled: boolean; failure: { reason: unknown } | null } = { fulfilled: false, failure: null };
    const work = response.then(async () => {
      try { await route.fulfill({ status: 204, body: '' }); status.fulfilled = true; }
      catch (reason) { status.failure = { reason }; }
    });
    records.push({ work, status });
    await work;
  };
  await page.route(pattern, handler);
  let draining: Promise<void> | null = null;
  function settle(): Promise<void> {
    if (!released) { released = true; release(); }
    if (draining) return draining;
    const work = (async () => {
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        await record.work;
        if (record.status.failure) throw record.status.failure.reason;
        expect(record.status.fulfilled).toBe(true);
      }
    })();
    draining = work;
    return work.finally(() => { if (draining === work) draining = null; });
  }
  return { requests, settle, remove: () => page.unroute(pattern, handler), finished: null };
}
async function ready(page: Page, origin: string) {
  await observeNativeBoundaries(page);
  await page.goto(origin);
  const buttons = page.getByRole('region', { name: 'Actual chain panel' }).locator('.chain-nodes button');
  await buttons.nth(1).waitFor();
  expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  const panel = await page.getByRole('region', { name: 'Actual chain panel' }).locator('.chain-section').elementHandle();
  if (!panel) throw new Error('Actual mounted chain panel missing');
  const originalURL = page.url();
  expect(new URL(originalURL).origin).toBe(origin);
  return { panel, originalURL };
}
type Ready = Awaited<ReturnType<typeof ready>>;
async function sameDocument(page: Page, state: Ready) {
  expect(page.url()).toBe(state.originalURL);
  expect(await state.panel.evaluate(panel => panel.isConnected && panel === document.querySelector('[aria-label="Actual chain panel"] .chain-section'))).toBe(true);
}
function dispatchChainButton(page: Page, index: number) {
  // Controlled fixture DOM dispatch; this is not a physical pointer gesture.
  return page.evaluate(index => {
    const button = document.querySelectorAll('[aria-label="Actual chain panel"] .chain-nodes button')[index];
    if (!(button instanceof HTMLButtonElement)) throw new Error('Actual chain button missing');
    button.click();
  }, index);
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const result = await window.chainLatchProbe.storage.peekChainHandover();
    return result?.kind === 'ready'
      ? { token: result.token, name: result.file.name, target: result.targetToolId, text: await result.file.text() }
      : null;
  });
}
async function currentHandoff(page: Page, gate: NavigationGate, state: Ready) {
  const before = gate.requests.length;
  const dispatch = dispatchChainButton(page, 0);
  await expect.poll(() => gate.requests.length, { timeout: 2000 }).toBe(before + 1);
  await gate.settle(); await dispatch; await gate.settle();
  await sameDocument(page, state);
  const actual = await stored(page);
  const target = new URL(gate.requests.at(-1)!).pathname.split('/').at(-1);
  expect(actual?.target).toBe(target);
  const trail = await page.evaluate(() => window.chainLatchProbe.trail.getTrailHandover());
  expect(trail?.token).toBe(actual?.token); expect(trail?.targetToolId).toBe(target);
  return actual;
}
async function finish(page: Page, gate: NavigationGate, closeOwned: () => Promise<void> = () => page.close(), primary?: { reason: unknown }) {
  if (!gate.finished) gate.finished = (async () => {
    const errors: unknown[] = [];
    const retain = (reason: unknown) => { if (!errors.some(error => Object.is(error, reason))) errors.push(reason); };
    try { await gate.settle(); } catch (reason) { retain(reason); }
    if (errors.length === 0) {
      try { await page.evaluate(() => window.chainLatchControl?.releaseIfHeld()); } catch (reason) { retain(reason); }
    }
    try { await gate.settle(); } catch (reason) { retain(reason); }
    try { await gate.remove(); } catch (reason) { retain(reason); }
    try { await gate.settle(); } catch (reason) { retain(reason); }
    try { await closeOwned(); } catch (reason) { retain(reason); }
    if (errors.length) throw new AggregateError(errors, 'Owned latch-test cleanup failed');
  })();
  try { await gate.finished; }
  catch (reason) { if (primary) throw new AggregateError([primary.reason, reason], 'Latch assertion and owned cleanup failed'); throw reason; }
}
async function nativeSnapshot(page: Page) {
  return page.evaluate(() => ({ status: window.chainLatchControl.status(), trail: window.chainLatchProbe.trail.getTrailHandover() }));
}
type Retention = Awaited<ReturnType<typeof nativeSnapshot>> & { stored: Awaited<ReturnType<typeof stored>>; requests: string[] };
function assertRetained(before: Retention, after: Retention) {
  expect(after.status.opens, 'SOURCE7_RETENTION_NATIVE_OPEN_COUNT').toBe(before.status.opens);
  expect(after.status.puts).toBe(before.status.puts);
  expect(after.trail).toEqual(before.trail);
  expect(after.stored).toEqual(before.stored);
  expect(after.requests).toEqual(before.requests);
  expect(after.requests).toHaveLength(1);
}

it('committed stale stash clears only its token, preserves a newer page singleton, and unlocks the current panel', async () => {
  const context = await harness.browser.newContext();
  const page = await context.newPage();
  const other = await context.newPage();
  const gate = await holdOwnedNavigation(page, harness.url);
  let primary: { reason: unknown } | undefined;
  try {
    const state = await ready(page, harness.url);
    await other.goto(harness.url);
    await page.evaluate(() => window.chainLatchControl.armCompletion(1));
    await dispatchChainButton(page, 0);
    await page.waitForFunction(() => window.chainLatchControl.status().held);
    const old = await stored(page);
    expect(old?.name).toBe('completed-original.mp4');
    expect(old?.text).toBe('completed original result');
    const newer = await other.evaluate(async () => {
      const result = await window.chainLatchProbe.storage.stashChainHandover(new File(['newer owned result'], 'newer.mp4', { type: 'video/mp4' }), { autoAccept: true, targetToolId: 'compress-video' });
      if (!result.stored) throw new Error('Second native stash did not commit');
      return result.token;
    });
    expect(newer).not.toBe(old?.token);
    await page.getByRole('button', { name: 'Replace completed result', exact: true }).click();
    expect(await page.getByLabel('Current completed result').textContent()).toContain('completed-replacement-1.mp4');
    const completed = await page.evaluate(() => window.chainLatchControl.status().completed);
    await page.evaluate(() => window.chainLatchControl.releaseIfHeld());
    await page.waitForFunction((prior) => window.chainLatchControl.status().completed > prior, completed);
    expect(gate.requests).toEqual([]);
    expect((await stored(page))?.token).toBe(newer);
    const current = await currentHandoff(page, gate, state);
    expect(current?.name).toBe('completed-replacement-1.mp4');
    expect(current?.text).toBe('completed replacement result 1');
  } catch (reason) { primary = { reason }; throw reason; }
  finally { await finish(page, gate, () => context.close(), primary); }
}, 20000);

it('trail failure retains warning/download recovery and a later current gesture succeeds', async () => {
  const page = await harness.browser.newPage();
  const gate = await holdOwnedNavigation(page, harness.url);
  let primary: { reason: unknown } | undefined;
  try {
    const state = await ready(page, harness.url);
    await page.evaluate(() => window.chainLatchControl.failTrailWrites(true));
    const download = page.waitForEvent('download');
    await dispatchChainButton(page, 0);
    expect((await download).suggestedFilename()).toBe('completed-original.mp4');
    await page.locator('.chain-notice').waitFor();
    expect(await page.locator('.chain-notice').textContent()).toContain("Couldn't carry the file over");
    expect(await stored(page)).toBeNull(); expect(gate.requests).toEqual([]);
    await page.evaluate(() => window.chainLatchControl.failTrailWrites(false));
    expect((await currentHandoff(page, gate, state))?.name).toBe('completed-original.mp4');
  } catch (reason) { primary = { reason }; throw reason; }
  finally { await finish(page, gate, undefined, primary); }
}, 20000);

it('staleness while the real compare-delete completion is held still unlocks its owned latch', async () => {
  const page = await harness.browser.newPage();
  const gate = await holdOwnedNavigation(page, harness.url);
  let primary: { reason: unknown } | undefined;
  try {
    const state = await ready(page, harness.url);
    await page.evaluate(() => { window.chainLatchControl.failTrailWrites(true); window.chainLatchControl.armCompletion(2); });
    await dispatchChainButton(page, 0);
    await page.waitForFunction(() => window.chainLatchControl.status().held);
    expect(await stored(page)).toBeNull(); // The real delete committed before its callback was held.
    await page.getByRole('button', { name: 'Replace completed result', exact: true }).click();
    expect(await page.getByLabel('Current completed result').textContent()).toContain('completed-replacement-1.mp4');
    await page.evaluate(() => { window.chainLatchControl.failTrailWrites(false); window.chainLatchControl.releaseIfHeld(); });
    expect(gate.requests).toEqual([]);
    expect((await currentHandoff(page, gate, state))?.name).toBe('completed-replacement-1.mp4');
  } catch (reason) { primary = { reason }; throw reason; }
  finally { await finish(page, gate, undefined, primary); }
}, 20000);

it('synchronous File setup failure after latch acquisition preserves the error and permits a later gesture', async () => {
  const page = await harness.browser.newPage();
  const gate = await holdOwnedNavigation(page, harness.url);
  let primary: { reason: unknown } | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const state = await ready(page, harness.url);
    await page.evaluate(() => window.chainLatchControl.failFileOnce());
    const expected = page.waitForEvent('pageerror', { predicate: (error) => error.message.includes('CONTROLLED_CHAIN_FILE_CONSTRUCTOR') });
    await dispatchChainButton(page, 0);
    await expected;
    expect(await page.evaluate(() => window.chainLatchControl.status().fileFaults)).toBe(1);
    expect(await page.evaluate(() => window.chainLatchControl.status().puts)).toBe(0);
    expect(gate.requests).toEqual([]);
    await page.evaluate(() => window.chainLatchControl.restoreFile());
    expect((await currentHandoff(page, gate, state))?.name).toBe('completed-original.mp4');
    expect(errors).toEqual(['CONTROLLED_CHAIN_FILE_CONSTRUCTOR']);
  } catch (reason) { primary = { reason }; throw reason; }
  finally { await finish(page, gate, undefined, primary); }
}, 20000);

it('actual successful location assignment keeps the same mounted panel latched after its owned204 response settles', async () => {
  const page = await harness.browser.newPage();
  const gate = await holdOwnedNavigation(page, harness.url);
  let primary: { reason: unknown } | undefined;
  try {
    const state = await ready(page, harness.url);
    const first = await currentHandoff(page, gate, state);
    expect(first?.name).toBe('completed-original.mp4');
    expect(await page.getByLabel('Current completed result').textContent()).toContain('completed-original.mp4');
    const before: Retention = { ...await nativeSnapshot(page), stored: first, requests: [...gate.requests] };
    expect(before.status.puts).toBe(1);
    const dispatch = dispatchChainButton(page, 1);
    await gate.settle(); await dispatch; await gate.settle(); await sameDocument(page, state);
    const afterNative = await nativeSnapshot(page);
    const after: Retention = { ...afterNative, requests: [...gate.requests], stored: await stored(page) };
    // A second navigate would synchronously call openDb before its first await.
    assertRetained(before, after);
  } catch (reason) { primary = { reason }; throw reason; }
  finally { await finish(page, gate, undefined, primary); }
}, 20000);

it('the same retention oracle rejects an executed unconditional-unlock compiler mutant after real extra native handoff witnesses', async () => {
  let mutantHarness: Awaited<ReturnType<typeof openMediaCallerHarness>> | undefined;
  let page: Page | undefined;
  let gate: NavigationGate | undefined;
  let primary: { reason: unknown } | undefined;
  const cleanupErrors: unknown[] = [];
  try {
    compileMutation.selectedReads = 0; compileMutation.inverseExact = false; compileMutation.changedFinally = false;
    compileMutation.enabled = true;
    try { mutantHarness = await openMediaCallerHarness('./test/fixtures/ChainSectionLatchHarness.svelte'); }
    finally { compileMutation.enabled = false; }
    expect(compileMutation.selectedReads).toBe(1); expect(compileMutation.inverseExact).toBe(true); expect(compileMutation.changedFinally).toBe(true);
    page = await mutantHarness.browser.newPage();
    gate = await holdOwnedNavigation(page, mutantHarness.url);
    const state = await ready(page, mutantHarness.url);
    const first = await currentHandoff(page, gate, state);
    expect(first?.name).toBe('completed-original.mp4'); expect(first?.text).toBe('completed original result');
    expect(await page.getByLabel('Current completed result').textContent()).toContain('completed-original.mp4');
    const before: Retention = { ...await nativeSnapshot(page), stored: first, requests: [...gate.requests] };
    expect(before.status.puts).toBe(1); expect(before.requests).toHaveLength(1);
    const dispatch = dispatchChainButton(page, 1);
    await expect.poll(() => gate?.requests.length, { timeout: 2000 }).toBe(2);
    await gate.settle(); await dispatch; await gate.settle(); await sameDocument(page, state);
    const afterNative = await nativeSnapshot(page); // Capture before the test's post-gesture readonly peek opens IDB.
    const after: Retention = { ...afterNative, requests: [...gate.requests], stored: await stored(page) };
    expect(after.status.opens).toBeGreaterThan(before.status.opens); expect(after.status.puts).toBe(before.status.puts + 1);
    expect(after.requests).toHaveLength(2); expect(after.stored?.token).toBeTruthy(); expect(after.stored?.token).not.toBe(first?.token);
    expect(after.stored?.name).toBe(first?.name); expect(after.stored?.text).toBe(first?.text);
    expect(after.stored?.target).toBe(new URL(after.requests[1]).pathname.split('/').at(-1));
    expect(after.trail).not.toEqual(before.trail); expect(after.trail?.token).toBe(after.stored?.token); expect(after.trail?.targetToolId).toBe(after.stored?.target);
    let rejection: unknown;
    try { assertRetained(before, after); } catch (reason) { rejection = reason; }
    if (!(rejection instanceof Error)) throw new Error('Actual semantic retention assertion rejection missing');
    expect(rejection.name).toBe('AssertionError'); expect(rejection.message).toContain('SOURCE7_RETENTION_NATIVE_OPEN_COUNT');
  } catch (reason) { primary = { reason }; }
  finally {
    compileMutation.enabled = false;
    if (page && gate) { try { await finish(page, gate); } catch (reason) { cleanupErrors.push(reason); } }
    else if (page) { try { await page.close(); } catch (reason) { cleanupErrors.push(reason); } }
    if (mutantHarness) { try { await mutantHarness.close(); } catch (reason) { cleanupErrors.push(reason); } }
  }
  if (cleanupErrors.length) throw new AggregateError(primary ? [primary.reason, ...cleanupErrors] : cleanupErrors, 'Mutant owned cleanup failed');
  if (primary) throw primary.reason;
}, 20000);
