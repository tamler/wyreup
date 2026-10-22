/** IndexedDB file handover; tokens correlate local admission, never network identity. */
const DB_NAME = 'wyreup';
const DB_VERSION = 1;
const STORE = 'chain-input';
const KEY = 'pending';

export interface ChainHandoverOptions {
  autoAccept?: boolean;
  targetToolId?: string;
}

interface HandoverMetadata extends ChainHandoverOptions {
  intentValid: boolean;
}

export type ChainHandover =
  | (HandoverMetadata & { kind: 'ready'; file: File; token: string })
  | (HandoverMetadata & { kind: 'recoverable'; file: File; token: null; message: string })
  | { kind: 'unavailable'; message: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

/** Attach before awaiting requests; failures are handled even on an early return. */
function txComplete(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

function reqResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readableFile(value: unknown): { record: Record<string, unknown>; file: File } | null {
  const record = recordObject(value);
  if (
    !record ||
    !(record.blob instanceof Blob) ||
    typeof record.name !== 'string' ||
    typeof record.type !== 'string'
  )
    return null;
  const file = new File([record.blob], record.name, {
    type: record.type,
    lastModified: record.blob instanceof File ? record.blob.lastModified : undefined,
  });
  if (file.name !== record.name || file.type !== record.type) return null;
  return { record, file };
}

function hasTargetIntent(record: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(record, 'targetToolId');
}

function isTarget(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

function isToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  );
}

function metadata(record: Record<string, unknown>): HandoverMetadata {
  const intentValid =
    (record.autoAccept === undefined || typeof record.autoAccept === 'boolean') &&
    (!hasTargetIntent(record) || isTarget(record.targetToolId));
  return {
    autoAccept: intentValid && typeof record.autoAccept === 'boolean' ? record.autoAccept : false,
    targetToolId: isTarget(record.targetToolId) ? record.targetToolId : undefined,
    intentValid,
  };
}

/** Returns its own committed token, even if a later writer replaces the singleton. */
export async function stashChainHandover(
  file: File,
  options: ChainHandoverOptions = {},
): Promise<{ stored: true; token: string } | { stored: false }> {
  let db: IDBDatabase | undefined;
  try {
    if (
      !(file instanceof File) ||
      (options.autoAccept !== undefined && typeof options.autoAccept !== 'boolean') ||
      (options.targetToolId !== undefined && !isTarget(options.targetToolId))
    )
      return { stored: false };
    const token = crypto.randomUUID();
    const record = {
      name: file.name,
      type: file.type,
      blob: file,
      autoAccept: options.autoAccept,
      token,
      ...(options.targetToolId === undefined ? {} : { targetToolId: options.targetToolId }),
    };
    db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const complete = txComplete(transaction);
    transaction.objectStore(STORE).put(record, KEY);
    return (await complete) ? { stored: true, token } : { stored: false };
  } catch {
    return { stored: false };
  } finally {
    db?.close();
  }
}

export async function stashChainFile(
  file: File,
  options: ChainHandoverOptions = {},
): Promise<boolean> {
  return (await stashChainHandover(file, options)).stored;
}

/** Never consumes; lazy migration changes only the token of valid legacy metadata. */
export async function peekChainHandover(): Promise<ChainHandover | null> {
  let db: IDBDatabase | undefined;
  let known: { record: Record<string, unknown>; file: File } | null = null;
  try {
    db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const complete = txComplete(transaction);
    const store = transaction.objectStore(STORE);
    const raw: unknown = await reqResult(store.get(KEY));
    if (raw === undefined)
      return (await complete)
        ? null
        : { kind: 'unavailable', message: 'Stored file could not be read.' };
    known = readableFile(raw);
    if (!known) {
      await complete;
      return { kind: 'unavailable', message: 'Stored file metadata is invalid; it was retained.' };
    }
    let token = known.record.token;
    const meta = metadata(known.record);
    if (!Object.prototype.hasOwnProperty.call(known.record, 'token') && meta.intentValid) {
      token = crypto.randomUUID();
      store.put({ ...known.record, token }, KEY);
    }
    if ((await complete) && isToken(token))
      return { kind: 'ready', file: known.file, token, ...meta };
    return {
      kind: 'recoverable',
      file: known.file,
      token: null,
      message: 'Original file is available, but storage ownership could not be confirmed.',
      ...meta,
    };
  } catch {
    return known
      ? {
          kind: 'recoverable',
          file: known.file,
          token: null,
          message: 'Original file is available, but storage ownership could not be confirmed.',
          ...metadata(known.record),
        }
      : { kind: 'unavailable', message: 'Stored file could not be read.' };
  } finally {
    db?.close();
  }
}

/** Match and delete in one transaction; failure/mismatch never clears another file. */
export async function clearChainHandover(token: string): Promise<boolean> {
  if (!isToken(token)) return false;
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const complete = txComplete(transaction);
    const store = transaction.objectStore(STORE);
    const raw: unknown = await reqResult(store.get(KEY));
    const record = recordObject(raw);
    if (!record || record.token !== token) {
      await complete;
      return false;
    }
    store.delete(KEY);
    return await complete;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Legacy no-argument consumption is only for readable UNBOUND records. */
export async function consumeChainFile(): Promise<File | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const complete = txComplete(transaction);
    const store = transaction.objectStore(STORE);
    const raw: unknown = await reqResult(store.get(KEY));
    const known = readableFile(raw);
    if (!known || hasTargetIntent(known.record) || !metadata(known.record).intentValid) {
      await complete;
      return null;
    }
    store.delete(KEY);
    return (await complete) ? known.file : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** Preserved legacy metadata-only API, with no mutation or consumption. */
export async function peekChainFile(): Promise<{
  name: string;
  type: string;
  autoAccept?: boolean;
} | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const transaction = db.transaction(STORE, 'readonly');
    const complete = txComplete(transaction);
    const raw: unknown = await reqResult(transaction.objectStore(STORE).get(KEY));
    const known = readableFile(raw);
    return (await complete) && known
      ? {
          name: known.file.name,
          type: known.file.type,
          autoAccept:
            typeof known.record.autoAccept === 'boolean' ? known.record.autoAccept : undefined,
        }
      : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** Legacy dismiss refuses bound or malformed destination intent. */
export async function clearChainFile(): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const transaction = db.transaction(STORE, 'readwrite');
    const complete = txComplete(transaction);
    const store = transaction.objectStore(STORE);
    const raw: unknown = await reqResult(store.get(KEY));
    const known = readableFile(raw);
    if (known && !hasTargetIntent(known.record) && metadata(known.record).intentValid)
      store.delete(KEY);
    await complete;
  } catch {
    // Legacy callers cannot report a result; the record is retained on failure.
  } finally {
    db?.close();
  }
}
