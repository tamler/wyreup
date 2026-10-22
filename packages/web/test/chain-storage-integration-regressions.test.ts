import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ChainStorageHarness.svelte');
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
      request.onerror = () => reject(request.error ?? new Error('Open failed.'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('chain-input', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Write failed.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Write aborted.'));
        transaction.objectStore('chain-input').put({
          name: 'original.bin', type: 'application/octet-stream',
          blob: new Blob([new Uint8Array([0, 255, 13, 10, 128])]), ...extra,
        }, 'pending');
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
      request.onerror = () => reject(request.error ?? new Error('Open failed.'));
    });
    try {
      const record = await new Promise<{ name: string; type: string; blob: Blob } | undefined>((resolve, reject) => {
        const request = db.transaction('chain-input', 'readonly').objectStore('chain-input').get('pending');
        request.onsuccess = () => {
          const value: unknown = request.result;
          if (value === undefined) resolve(value);
          else if (typeof value === 'object' && value !== null &&
            'name' in value && typeof value.name === 'string' &&
            'type' in value && typeof value.type === 'string' &&
            'blob' in value && value.blob instanceof Blob) {
            resolve({ name: value.name, type: value.type, blob: value.blob });
          } else reject(new Error('Unexpected stored fixture record.'));
        };
        request.onerror = () => reject(request.error ?? new Error('Read failed.'));
      });
      return record ? { name: record.name, type: record.type, bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())) } : null;
    } finally {
      db.close();
    }
  });
}

const original = { name: 'original.bin', type: 'application/octet-stream', bytes: [0, 255, 13, 10, 128] };
for (const [label, intent] of [
  ['bound', { targetToolId: 'csv-viewer', token: 'owned-token', autoAccept: true }],
  ['malformed target', { targetToolId: 42, token: 'owned-token', autoAccept: true }],
] as const) {
  for (const operation of ['consumeChainFile', 'clearChainFile'] as const) {
    it(`legacy ${operation} preserves ${label} handover bytes`, async () => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(harness.url);
        await seed(page, intent);
        const consumed = await page.evaluate(async (name) => {
          const probe = (window as unknown as { chainStorageProbe: {
            consumeChainFile: () => Promise<File | null>; clearChainFile: () => Promise<void>;
          } }).chainStorageProbe;
          const result = await probe[name]();
          return result instanceof File;
        }, operation);
        expect(consumed).toBe(false);
        expect(await persisted(page)).toEqual(original);
      } finally {
        await page.close();
      }
    }, 30000);
  }
}

it('legacy unbound consume retains exact bytes and clears only its record', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await seed(page, { autoAccept: false });
    const result = await page.evaluate(async () => {
      const probe = (window as unknown as { chainStorageProbe: { consumeChainFile: () => Promise<File | null> } }).chainStorageProbe;
      const file = await probe.consumeChainFile();
      return file ? { name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) } : null;
    });
    expect(result).toEqual(original);
    expect(await persisted(page)).toBeNull();
  } finally {
    await page.close();
  }
}, 30000);
