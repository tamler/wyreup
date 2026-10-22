import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/ChainStorageHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

for (const operation of ['consumeChainFile', 'clearChainFile'] as const) {
  it(`legacy ${operation} refuses an invalid automatic-staging hint without deleting bytes`, async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const outcome = await page.evaluate(async (name) => {
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
            transaction.objectStore('chain-input').put({ name: 'original.bin', type: 'application/octet-stream', blob: new Blob([new Uint8Array([0, 255, 128])]), autoAccept: 'yes' }, 'pending');
          });
          const probe = (window as unknown as { chainStorageProbe: {
            consumeChainFile: () => Promise<File | null>; clearChainFile: () => Promise<void>;
          } }).chainStorageProbe;
          const result = await probe[name]();
          const saved = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => {
            const request = db.transaction('chain-input', 'readonly').objectStore('chain-input').get('pending');
            request.onsuccess = () => {
              const value: unknown = request.result;
              if (value === undefined) resolve(value);
              else if (typeof value === 'object' && value !== null &&
                'blob' in value && value.blob instanceof Blob) resolve({ blob: value.blob });
              else reject(new Error('Unexpected stored fixture record.'));
            };
            request.onerror = () => reject(request.error ?? new Error('Read failed.'));
          });
          return { consumed: result instanceof File, bytes: saved ? Array.from(new Uint8Array(await saved.blob.arrayBuffer())) : null };
        } finally { db.close(); }
      }, operation);
      expect(outcome).toEqual({ consumed: false, bytes: [0, 255, 128] });
    } finally { await page.close(); }
  }, 30000);
}
