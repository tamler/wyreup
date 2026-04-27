/**
 * IndexedDB-backed file passthrough between tool pages.
 *
 * The previous implementation JSON-stringified file bytes into sessionStorage,
 * which meant binary data ballooned ~3-4× on the way in and hit the 5–10 MB
 * sessionStorage quota. Files were silently dropped past ~3 MB raw.
 *
 * Storing the Blob directly in IndexedDB avoids serialization entirely — the
 * browser persists the binary natively. Per-origin quota is in the GB range.
 * No artificial size cap; let the browser's QuotaExceededError surface
 * through `stashChainFile` returning false, and callers fall back to the
 * "download and re-upload" affordance.
 */

const DB_NAME = 'wyreup';
const DB_VERSION = 1;
const STORE = 'chain-input';
const KEY = 'pending';

interface ChainRecord {
  name: string;
  type: string;
  blob: Blob;
  autoAccept?: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(idbError(req.error, 'IndexedDB open failed'));
  });
}

function idbError(err: DOMException | null, fallback: string): Error {
  return err ?? new Error(fallback);
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(idbError(tx.error, 'IndexedDB transaction failed'));
    tx.onabort = () => reject(idbError(tx.error, 'IndexedDB transaction aborted'));
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(idbError(req.error, 'IndexedDB request failed'));
  });
}

/** Stash a File for the next tool page to pick up. Returns false if storage failed. */
export async function stashChainFile(
  file: File,
  options: { autoAccept?: boolean } = {},
): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const record: ChainRecord = {
      name: file.name,
      type: file.type,
      blob: file,
      autoAccept: options.autoAccept,
    };
    tx.objectStore(STORE).put(record, KEY);
    await txComplete(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Retrieve and clear the stashed chain file, if any. */
export async function consumeChainFile(): Promise<File | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const record = (await reqResult(store.get(KEY))) as ChainRecord | undefined;
    if (!record) {
      db.close();
      return null;
    }
    store.delete(KEY);
    await txComplete(tx);
    db.close();
    return new File([record.blob], record.name, { type: record.type });
  } catch {
    return null;
  }
}

/** Peek at stashed file metadata without consuming it. */
export async function peekChainFile(): Promise<{
  name: string;
  type: string;
  autoAccept?: boolean;
} | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const record = (await reqResult(tx.objectStore(STORE).get(KEY))) as
      | ChainRecord
      | undefined;
    db.close();
    if (!record) return null;
    return { name: record.name, type: record.type, autoAccept: record.autoAccept };
  } catch {
    return null;
  }
}

/** Clear any stashed file without consuming it. Used by the dismiss action. */
export async function clearChainFile(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    await txComplete(tx);
    db.close();
  } catch {
    /* ignore */
  }
}
