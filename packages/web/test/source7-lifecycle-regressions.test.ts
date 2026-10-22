import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { openSource7LifecycleHarness } from './source7LifecycleHarness';

// Actual mounted components and native IndexedDB. Only scanner/PDF dependency
// results are fixed timing operands; these tests claim no native engine coverage.
let harness: Awaited<ReturnType<typeof openSource7LifecycleHarness>>;
beforeAll(async () => { harness = await openSource7LifecycleHarness(); }, 30000);
afterAll(async () => { await harness?.close(); });
type Caller = 'how' | 'job' | 'scenario' | 'filter';
type Probe = {
  scanNames(): string[];
  settleScan(index: number, outcome: 'high' | 'reject' | 'unanalysed'): void;
  runEvents(): Array<{ name: string; chainFingerprint: string }>;
  closeSnapshot(): { attempts: number[]; rejected: boolean };
  rejectFirstClose(): void;
};

async function pageCase(query: string, action: (page: Page) => Promise<void>) {
  const context = await harness.browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === harness.url ? route.continue() : route.abort());
    await page.goto(harness.url + query);
    await page.locator('[data-source7-ready="true"]').waitFor();
    await action(page);
    expect(errors).toEqual([]);
  } finally {
    // Release only the controlled notification of an already completed native
    // transaction if an assertion failed before its explicit release.
    await page.evaluate(() => {
      const p = (window as unknown as { source7IDB?: { committed: boolean; released: boolean; release(): void } }).source7IDB;
      if (p?.committed && !p.released) p.release();
    }).catch(() => {});
    await context.close();
  }
}

async function pending(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('wyreup', 1);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? new Error('Native IndexedDB open failed without a reason.'));
    });
    try {
      const tx = db.transaction('chain-input', 'readonly');
      const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Native IndexedDB transaction failed without a reason.')); });
      const req = tx.objectStore('chain-input').get('pending');
      function isStoredHandoff(value: unknown): value is { token: string; name: string; type: string; blob: Blob } {
        return value !== null && typeof value === 'object' && 'token' in value && typeof value.token === 'string' &&
          'name' in value && typeof value.name === 'string' && 'type' in value && typeof value.type === 'string' &&
          'blob' in value && value.blob instanceof Blob;
      }
      const row = await new Promise<{ token: string; name: string; type: string; blob: Blob } | undefined>((resolve, reject) => {
        req.onsuccess = () => {
          const value: unknown = req.result;
          if (value === undefined) { resolve(undefined); return; }
          if (!isStoredHandoff(value)) {
            reject(new Error('Actual stored handoff row has an invalid shape.')); return;
          }
          resolve(value);
        };
        req.onerror = () => reject(req.error ?? new Error('Native IndexedDB get failed without a reason.'));
      });
      await done;
      return row ? { token: row.token, name: row.name, type: row.type, bytes: Array.from(new Uint8Array(await row.blob.arrayBuffer())) } : null;
    } finally { db.close(); }
  });
}

async function holdCommittedPut(page: Page) {
  await page.evaluate(() => {
    const selected = new WeakSet<IDBTransaction>();
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    const getCompletion: unknown = descriptor ? Reflect.get(descriptor, 'get') : undefined;
    const setCompletion: unknown = descriptor ? Reflect.get(descriptor, 'set') : undefined;
    const transactionDescriptor = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'transaction');
    const putDescriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
    const transaction: unknown = transactionDescriptor?.value;
    const put: unknown = putDescriptor?.value;
    if (typeof getCompletion !== 'function' || typeof setCompletion !== 'function' ||
        typeof transaction !== 'function' || typeof put !== 'function') throw new Error('Actual native IndexedDB descriptors missing.');
    const probe = { committed: false, released: false, completedReadWritesAfterRelease: 0, release: () => {} };
    Object.assign(window, { source7IDB: probe });
    let armed = true;
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      ...putDescriptor,
      value(this: IDBObjectStore, ...args: unknown[]): unknown {
        const result: unknown = Reflect.apply(put, this, args);
        if (!(result instanceof IDBRequest)) throw new Error('Actual native put request missing.');
        if (this.name === 'chain-input' && this.transaction.db.name === 'wyreup' && args[1] === 'pending') selected.add(this.transaction);
        return result;
      },
    });
    Object.defineProperty(IDBDatabase.prototype, 'transaction', {
      ...transactionDescriptor,
      value(this: IDBDatabase, names: string | Iterable<string>, mode?: IDBTransactionMode, options?: IDBTransactionOptions): unknown {
        const tx: unknown = Reflect.apply(transaction, this, [typeof names === 'string' ? names : Array.from(names), mode, options]);
        if (!(tx instanceof IDBTransaction)) throw new Error('Actual native transaction missing.');
        if (this.name === 'wyreup' && mode === 'readwrite') Object.defineProperty(tx, 'oncomplete', {
        configurable: true,
        get() {
          const listener: unknown = Reflect.apply(getCompletion, tx, []);
          if (listener !== null && typeof listener !== 'function') throw new Error('Native completion getter returned an invalid listener.');
          return listener;
        },
        set(listener: IDBTransaction['oncomplete']) {
          Reflect.apply(setCompletion, tx, [(event: Event) => {
            if (armed && selected.has(tx) && listener) {
              armed = false; probe.committed = true;
              probe.release = () => {
                if (probe.released) throw new Error('Native completion released twice.');
                probe.released = true; listener.call(tx, event);
              };
            } else {
              listener?.call(tx, event);
              if (probe.released) probe.completedReadWritesAfterRelease++;
            }
          }]);
        },
      });
        return tx;
      },
    });
  });
}
async function committed(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { source7IDB: { committed: boolean } }).source7IDB.committed)).toBe(true);
}
async function release(page: Page) {
  await page.evaluate(() => (window as unknown as { source7IDB: { release(): void } }).source7IDB.release());
}
async function cleanupCompleted(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    source7IDB: { completedReadWritesAfterRelease: number };
  }).source7IDB.completedReadWritesAfterRelease)).toBe(1);
}
async function replaceToken(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('wyreup', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? new Error('Native IndexedDB open failed without a reason.')); });
    try {
      const tx = db.transaction('chain-input', 'readwrite');
      const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Native IndexedDB transaction failed without a reason.')); });
      tx.objectStore('chain-input').put({ token: 'source7-independent-writer', name: 'newer.txt', type: 'text/plain', blob: new File(['independent newer bytes'], 'newer.txt', { type: 'text/plain' }), autoAccept: false, targetToolId: 'word-counter' }, 'pending');
      await done;
    } finally { db.close(); }
  });
}
async function startHandoff(page: Page, caller: Caller) {
  const region = page.getByRole('region', { name: 'SOURCE7 caller', exact: true });
  if (caller === 'how') {
    await region.getByRole('option', { name: 'Count words', exact: true }).click();
    await region.getByRole('button', { name: 'Run Count words →', exact: true }).click();
  } else if (caller === 'job') {
    await region.locator('input[type="file"]').setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: Buffer.from('source7 original bytes') });
  } else await region.locator('a[href="/tools/word-counter"]').first().click();
}

for (const caller of ['how', 'job', 'scenario', 'filter'] as const) {
  for (const newer of [false, true]) {
    it(`${caller} compare-deletes only its abandoned committed handoff after unmount (newer=${newer})`, async () => {
      await pageCase('?scenario=handoff&caller=' + caller, async page => {
        const originalURL = page.url();
        await holdCommittedPut(page); await startHandoff(page, caller); await committed(page);
        const owned = await pending(page); expect(owned?.name).toBe('original.txt'); expect(owned?.token).toBeTruthy();
        await page.getByRole('button', { name: 'Unmount SOURCE7 target', exact: true }).click();
        if (newer) await replaceToken(page);
        const expected = newer ? await pending(page) : null;
        await release(page);
        await cleanupCompleted(page);
        await expect.poll(() => pending(page)).toEqual(expected);
        if (newer) { expect(expected?.token).toBe('source7-independent-writer'); expect(expected?.token).not.toBe(owned?.token); }
        expect(page.url()).toBe(originalURL);
      });
    }, 20000);
  }
  it(`${caller} removes its stored intent after actual sessionStorage trail refusal and retains download bytes`, async () => {
    await pageCase('?scenario=handoff&caller=' + caller, async page => {
      const originalURL = page.url();
      await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
        const setItem: unknown = descriptor?.value;
        if (typeof setItem !== 'function') throw new Error('Actual native storage setter missing.');
        Object.defineProperty(Storage.prototype, 'setItem', {
          ...descriptor,
          value(this: Storage, ...args: unknown[]): unknown {
            if (this === sessionStorage && args[0] === 'wyreup:hop-trail') throw new DOMException('Controlled trail refusal.', 'QuotaExceededError');
            const result: unknown = Reflect.apply(setItem, this, args);
            return result;
          },
        });
      });
      await holdCommittedPut(page); await startHandoff(page, caller); await committed(page);
      expect((await pending(page))?.token).toBeTruthy(); await release(page);
      await page.getByRole('alert').filter({ hasText: 'Could not complete the handover.' }).waitFor();
      await cleanupCompleted(page);
      await expect.poll(() => pending(page)).toBeNull(); expect(page.url()).toBe(originalURL);
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download original', exact: true }).click();
      const item = await downloaded; expect(item.suggestedFilename()).toBe('original.txt');
      const path = await item.path(); if (!path) throw new Error('Actual original download missing.');
      expect(await readFile(path)).toEqual(Buffer.from('source7 original bytes'));
    });
  }, 20000);
}

it('current pending scanner blocks Run until high acknowledgement, then dispatches only after explicit Run', async () => {
  await pageCase('?scenario=trigger', async page => {
    await expect.poll(() => page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.scanNames())).toEqual(['scan-original.txt']);
    await page.getByText('Scanning…', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Run', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.runEvents())).toEqual([]);
    expect(await page.getByRole('button', { name: 'Run', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.settleScan(0, 'high'));
    await page.getByRole('button', { name: 'Acknowledge severity to enable Run', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.runEvents())).toEqual([]);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.runEvents())).toEqual([{ name: 'scan-original.txt', chainFingerprint: '[{"toolId":"word-counter","params":{}}]' }]);
  });
}, 20000);

it('failed scanner remains visibly unanalysed and permits only the existing deliberate manual Run', async () => {
  await pageCase('?scenario=trigger', async page => {
    await expect.poll(() => page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.scanNames().length)).toBe(1);
    await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.settleScan(0, 'reject'));
    await page.getByText(/Not analysed/).waitFor();
    expect(await page.getByText('Clean — no suspicious markers detected.', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.runEvents())).toEqual([]);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.runEvents().map(event => event.name))).toEqual(['scan-original.txt']);
  });
}, 20000);

it('stale scan completion cannot unlock or dispatch the replacement input', async () => {
  await pageCase('?scenario=trigger', async page => {
    await expect.poll(() => page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.scanNames().length)).toBe(1);
    // Fixture-driven replacement behind the real modal backdrop; not a physical pointer click.
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter(button => button.textContent?.trim() === 'Replace scanner input');
      if (buttons.length !== 1 || !(buttons[0] instanceof HTMLButtonElement)) throw new Error('Exact scanner replacement fixture control missing.');
      buttons[0].click();
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.scanNames())).toEqual(['scan-original.txt', 'scan-replacement.txt']);
    await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.settleScan(0, 'high'));
    await page.getByText('Scanning…', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Run', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Acknowledge severity to enable Run', exact: true }).count()).toBe(0);
    await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.settleScan(1, 'unanalysed'));
    await page.getByText(/Not analysed/).waitFor();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.runEvents().map(event => event.name))).toEqual(['scan-replacement.txt']);
  });
}, 20000);

it.each(['crop', 'redact'])('%s preserves B error while separately retaining a real A-close rejection, once', async runner => {
  await pageCase('?scenario=pdf&runner=' + runner, async page => {
    await page.locator('canvas.pdf-canvas').waitFor();
    await expect.poll(() => page.getByRole('button', { name: 'Cancel PDF loading', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Replace PDF input', exact: true }).click();
    await page.getByText('Controlled replacement PDF read failed.', { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.closeSnapshot().attempts)).toEqual([1]);
    await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.rejectFirstClose());
    // Public replacement advances generation twice. Current-error clobber is
    // not asserted; the known missing obligation is separate warning retention.
    await page.getByText('Could not close the previous PDF reader.', { exact: true }).waitFor();
    expect(await page.getByText('Controlled replacement PDF read failed.', { exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { source7Probe: Probe }).source7Probe.closeSnapshot())).toEqual({ attempts: [1], rejected: true });
  });
}, 20000);
