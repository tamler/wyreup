import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type * as ChainStorage from '../src/components/runners/chainStorage';
import type * as Trail from '../src/components/runners/hopTrail';
import { openBrowserHarness } from './browserHarness';

declare global {
  interface Window {
    chainHandoverProbe: { storage: typeof ChainStorage; trail: typeof Trail };
  }
}

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ChainHandoverHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});

async function seed(page: Page, intent: Record<string, unknown>) {
  await page.evaluate(async (extra) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wyreup', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('chain-input');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Native open failed'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('chain-input', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Native transaction failed'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Native transaction aborted'));
        transaction.objectStore('chain-input').put(
          {
            name: 'original.bin',
            type: 'application/octet-stream',
            blob: new Blob([new Uint8Array([0, 255, 13, 10, 128])]),
            ...extra,
          },
          'pending',
        );
      });
    } finally {
      db.close();
    }
  }, intent);
}

async function persisted(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wyreup', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Native open failed'));
    });
    try {
      const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = db
          .transaction('chain-input', 'readonly')
          .objectStore('chain-input')
          .get('pending');
        request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
        request.onerror = () => reject(request.error ?? new Error('Native read failed'));
      });
      if (!record) return null;
      if (!(record.blob instanceof Blob)) throw new Error('Controlled record is not a Blob');
      return {
        name: record.name,
        type: record.type,
        token: record.token,
        autoAccept: record.autoAccept,
        targetToolId: record.targetToolId,
        extra: record.extra,
        keys: Object.keys(record).sort(),
        bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())),
      };
    } finally {
      db.close();
    }
  });
}

async function withPage(work: (page: Page) => Promise<void>) {
  const page = await harness.browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(harness.url);
    await work(page);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}

it('committed token and repeated peek preserve exact original bytes and target without consumption', async () => {
  await withPage(async (page) => {
    const result = await page.evaluate(async () => {
      const { storage } = window.chainHandoverProbe;
      const file = new File([new Uint8Array([0, 255, 13, 10, 128])], 'original.bin', {
        type: 'application/octet-stream',
      });
      const stashed = await storage.stashChainHandover(file, {
        autoAccept: true,
        targetToolId: 'csv-viewer',
      });
      const first = await storage.peekChainHandover();
      const second = await storage.peekChainHandover();
      if (!stashed.stored || first?.kind !== 'ready' || second?.kind !== 'ready')
        throw new Error('Native stash/peek did not commit');
      return {
        sameToken: first.token === stashed.token && second.token === first.token,
        name: first.file.name,
        type: first.file.type,
        bytes: Array.from(new Uint8Array(await first.file.arrayBuffer())),
        autoAccept: first.autoAccept,
        target: first.targetToolId,
        intentValid: first.intentValid,
      };
    });
    expect(result).toEqual({
      sameToken: true,
      name: 'original.bin',
      type: 'application/octet-stream',
      bytes: [0, 255, 13, 10, 128],
      autoAccept: true,
      target: 'csv-viewer',
      intentValid: true,
    });
    expect(await persisted(page)).not.toBeNull();
  });
}, 30000);

it('a stale token cannot delete a newer file committed in another page of the same browser context', async () => {
  const context = await harness.browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  try {
    await Promise.all([first.goto(harness.url), second.goto(harness.url)]);
    const oldToken = await first.evaluate(async () => {
      const result = await window.chainHandoverProbe.storage.stashChainHandover(
        new File(['old'], 'old.txt'),
        { targetToolId: 'word-counter' },
      );
      if (!result.stored) throw new Error('First stash failed');
      return result.token;
    });
    const newToken = await second.evaluate(async () => {
      const result = await window.chainHandoverProbe.storage.stashChainHandover(
        new File(['new'], 'new.txt'),
        { targetToolId: 'json-formatter' },
      );
      if (!result.stored) throw new Error('Second stash failed');
      return result.token;
    });
    expect(newToken).not.toBe(oldToken);
    expect(
      await first.evaluate(
        (token) => window.chainHandoverProbe.storage.clearChainHandover(token),
        oldToken,
      ),
    ).toBe(false);
    expect((await persisted(second))?.name).toBe('new.txt');
    expect(
      await second.evaluate(
        (token) => window.chainHandoverProbe.storage.clearChainHandover(token),
        newToken,
      ),
    ).toBe(true);
    expect(await persisted(first)).toBeNull();
  } finally {
    await context.close();
  }
}, 30000);

it('legacy migration adds only one stable token and preserves unrelated fields and unbound compatibility', async () => {
  await withPage(async (page) => {
    await seed(page, { autoAccept: false, extra: { kept: 7 } });
    const before = await persisted(page);
    const ready = await page.evaluate(async () => {
      const first = await window.chainHandoverProbe.storage.peekChainHandover();
      const second = await window.chainHandoverProbe.storage.peekChainHandover();
      return {
        kind: first?.kind,
        stable: first?.kind === 'ready' && second?.kind === 'ready' && first.token === second.token,
      };
    });
    expect(ready).toEqual({ kind: 'ready', stable: true });
    const after = await persisted(page);
    expect(after?.keys).toEqual([...(before?.keys ?? []), 'token'].sort());
    expect(after?.bytes).toEqual(before?.bytes);
    expect(after?.extra).toEqual({ kept: 7 });
    expect(after?.targetToolId).toBeUndefined();
    expect(after?.autoAccept).toBe(false);
    const consumed = await page.evaluate(async () => {
      const file = await window.chainHandoverProbe.storage.consumeChainFile();
      return file ? Array.from(new Uint8Array(await file.arrayBuffer())) : null;
    });
    expect(consumed).toEqual([0, 255, 13, 10, 128]);
    expect(await persisted(page)).toBeNull();
  });
}, 30000);

it('native aborted migration returns recoverable exact bytes without committing a token', async () => {
  await withPage(async (page) => {
    await seed(page, { autoAccept: false });
    const recovery = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
      if (!descriptor) throw new Error('Native put descriptor missing');
      Object.defineProperty(IDBObjectStore.prototype, 'put', {
        ...descriptor,
        value(this: IDBObjectStore) {
          this.transaction.abort();
          throw new DOMException('Controlled quota refusal', 'QuotaExceededError');
        },
      });
      try {
        const result = await window.chainHandoverProbe.storage.peekChainHandover();
        return result?.kind === 'recoverable'
          ? {
              kind: result.kind,
              token: result.token,
              name: result.file.name,
              bytes: Array.from(new Uint8Array(await result.file.arrayBuffer())),
            }
          : { kind: result?.kind };
      } finally {
        Object.defineProperty(IDBObjectStore.prototype, 'put', descriptor);
      }
    });
    expect(recovery).toEqual({
      kind: 'recoverable',
      token: null,
      name: 'original.bin',
      bytes: [0, 255, 13, 10, 128],
    });
    expect((await persisted(page))?.keys).not.toContain('token');
    expect(
      await page.evaluate(
        async () => (await window.chainHandoverProbe.storage.peekChainHandover())?.kind,
      ),
    ).toBe('ready');
  });
}, 30000);

it('quota-style native transaction abort returns false and preserves the previous singleton', async () => {
  await withPage(async (page) => {
    await seed(page, { autoAccept: false });
    const result = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
      if (!descriptor) throw new Error('Native put descriptor missing');
      Object.defineProperty(IDBObjectStore.prototype, 'put', {
        ...descriptor,
        value(this: IDBObjectStore) {
          this.transaction.abort();
          throw new DOMException('Controlled quota refusal', 'QuotaExceededError');
        },
      });
      try {
        const file = new File(['replacement'], 'replacement.txt');
        return {
          companion: await window.chainHandoverProbe.storage.stashChainHandover(file),
          legacy: await window.chainHandoverProbe.storage.stashChainFile(file),
        };
      } finally {
        Object.defineProperty(IDBObjectStore.prototype, 'put', descriptor);
      }
    });
    expect(result).toEqual({ companion: { stored: false }, legacy: false });
    expect((await persisted(page))?.bytes).toEqual([0, 255, 13, 10, 128]);
    expect((await persisted(page))?.name).toBe('original.bin');
  });
}, 30000);

it('malformed destination remains manual and legacy operations cannot erase it', async () => {
  await withPage(async (page) => {
    await seed(page, { autoAccept: true, targetToolId: 42, token: 'owned-token' });
    const result = await page.evaluate(async () => {
      const result = await window.chainHandoverProbe.storage.peekChainHandover();
      await window.chainHandoverProbe.storage.clearChainFile();
      const consumed = await window.chainHandoverProbe.storage.consumeChainFile();
      return {
        kind: result?.kind,
        intentValid: result?.kind === 'ready' ? result.intentValid : undefined,
        autoAccept: result?.kind === 'ready' ? result.autoAccept : undefined,
        consumed: consumed !== null,
      };
    });
    expect(result).toEqual({
      kind: 'ready',
      intentValid: false,
      autoAccept: false,
      consumed: false,
    });
    expect((await persisted(page))?.bytes).toEqual([0, 255, 13, 10, 128]);
  });
}, 30000);

it('read failure returns unavailable, while a genuinely successful empty read returns null', async () => {
  await withPage(async (page) => {
    expect(
      await page.evaluate(() => window.chainHandoverProbe.storage.peekChainHandover()),
    ).toBeNull();
    const result = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBFactory.prototype, 'open');
      if (!descriptor) throw new Error('Native open descriptor missing');
      Object.defineProperty(IDBFactory.prototype, 'open', {
        ...descriptor,
        value() {
          throw new DOMException('Controlled denial', 'SecurityError');
        },
      });
      try {
        return await window.chainHandoverProbe.storage.peekChainHandover();
      } finally {
        Object.defineProperty(IDBFactory.prototype, 'open', descriptor);
      }
    });
    expect(result?.kind).toBe('unavailable');
    expect(result && 'file' in result).toBe(false);
  });
}, 30000);

it('bound trail preserves token/target and fails closed on quota/removal failure without invented continuity', async () => {
  await withPage(async (page) => {
    const result = await page.evaluate(() => {
      const { trail } = window.chainHandoverProbe;
      const steps = [{ toolId: 'word-counter', params: {} }];
      const initial = trail.setTrailHandover(steps, 'first-token', 'json-formatter');
      const first = trail.getTrailHandover();
      const setDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
      const removeDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'removeItem');
      if (!setDescriptor || !removeDescriptor)
        throw new Error('Native Storage descriptors missing');
      Object.defineProperty(Storage.prototype, 'setItem', {
        ...setDescriptor,
        value() {
          throw new DOMException('Controlled quota', 'QuotaExceededError');
        },
      });
      Object.defineProperty(Storage.prototype, 'removeItem', {
        ...removeDescriptor,
        value() {
          throw new DOMException('Controlled denial', 'SecurityError');
        },
      });
      let failed: boolean;
      let refused: ReturnType<typeof trail.getTrailHandover>;
      try {
        failed = trail.setTrailHandover(steps, 'second-token', 'csv-viewer');
        refused = trail.getTrailHandover();
      } finally {
        Object.defineProperty(Storage.prototype, 'setItem', setDescriptor);
        Object.defineProperty(Storage.prototype, 'removeItem', removeDescriptor);
      }
      const afterRestore = trail.getTrailHandover();
      const retry = trail.setTrailHandover(steps, 'third-token', 'csv-viewer');
      const current = trail.getTrailHandover();
      const tooMany = trail.setTrailHandover(
        Array.from({ length: 21 }, () => ({ toolId: 'word-counter', params: {} })),
        'fourth-token',
        'csv-viewer',
      );
      return {
        initial,
        first,
        failed,
        refused,
        afterRestore,
        retry,
        current,
        tooMany,
        final: trail.getTrailHandover(),
      };
    });
    expect(result).toEqual({
      initial: true,
      first: {
        steps: [{ toolId: 'word-counter', params: {} }],
        token: 'first-token',
        targetToolId: 'json-formatter',
      },
      failed: false,
      refused: null,
      afterRestore: null,
      retry: true,
      current: {
        steps: [{ toolId: 'word-counter', params: {} }],
        token: 'third-token',
        targetToolId: 'csv-viewer',
      },
      tooMany: false,
      final: null,
    });
  });
}, 30000);
