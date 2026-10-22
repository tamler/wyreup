import { createFileWorker } from './file-job-platform.js';
import { validateCsvTable, type CsvDelimiter, type CsvTable } from './csv-data.js';
import type { UtilityParams } from './common.js';
import type { BankFileJob } from './bank-job.js';

export interface OwnedFileWorker {
  send(message: unknown, transfer?: ArrayBuffer[]): void;
  listen(onMessage: (value: unknown) => void, onError: (error: Error) => void): () => void;
  terminate(): void | Promise<number>;
}
export interface CsvFileJob {
  type: 'csv-parse';
  bytes: Uint8Array;
  params: { delimiter: CsvDelimiter; hasHeader: boolean };
}
export interface PsdFileJob {
  type: 'psd-png';
  bytes: Uint8Array;
  params: { alphaMode: 'auto' | 'channel-as-transparency' };
}
export interface PitchFileJob {
  type: 'midi-pitch';
  bytes: Uint8Array;
  params: UtilityParams;
}
export interface StlFileJob {
  type: 'stl-contours';
  bytes: Uint8Array;
  params: UtilityParams;
}
export interface PsdPngResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  alphaSource: 'merged-transparency' | 'explicit-channel' | 'opaque';
}

export function validatePsdPngResult(value: unknown): PsdPngResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid PNG result.');
  const result = value as Record<string, unknown>;
  const { bytes, width, height, alphaSource } = result;
  if (
    Object.keys(result).sort().join(',') !== 'alphaSource,bytes,height,width' ||
    !(bytes instanceof Uint8Array) ||
    bytes.length < 33 ||
    bytes.length > 96 * 1024 * 1024 ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16000000 ||
    !['merged-transparency', 'explicit-channel', 'opaque'].includes(String(alphaSource)) ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  )
    throw new Error('Invalid bounded PNG result.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== width ||
    header.getUint32(20) !== height
  )
    throw new Error('PNG dimensions do not match the decoded composite.');
  return { bytes, width, height, alphaSource: alphaSource as PsdPngResult['alphaSource'] };
}

export function runCsvFileJob(
  input: CsvFileJob,
  signal: AbortSignal,
  factory: () => Promise<OwnedFileWorker> = createFileWorker,
): Promise<CsvTable> {
  if (signal.aborted) return Promise.reject(new Error('File processing cancelled.'));
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > 10 * 1024 * 1024)
    return Promise.reject(new Error('CSV input exceeds 10 MiB or is not bytes.'));
  return runOwnedFileJob(
    input,
    signal,
    (value) => {
      const table = value as CsvTable;
      validateCsvTable(table, signal);
      return table;
    },
    factory,
  );
}

export function runPsdFileJob(
  input: PsdFileJob,
  signal: AbortSignal,
  factory: () => Promise<OwnedFileWorker> = createFileWorker,
): Promise<PsdPngResult> {
  if (signal.aborted) return Promise.reject(new Error('File processing cancelled.'));
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > 64 * 1024 * 1024)
    return Promise.reject(new Error('PSD input exceeds 64 MiB or is not bytes.'));
  return runOwnedFileJob(input, signal, validatePsdPngResult, factory);
}

export function runOwnedFileJob<T>(
  input: CsvFileJob | PsdFileJob | PitchFileJob | StlFileJob | BankFileJob,
  signal: AbortSignal,
  validate: (value: unknown) => T,
  factory: () => Promise<OwnedFileWorker>,
): Promise<T> {
  if (!(input.bytes.buffer instanceof ArrayBuffer))
    return Promise.reject(new Error('File jobs require an owned ArrayBuffer, not shared memory.'));
  const jobId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: OwnedFileWorker | undefined;
    let unlisten: (() => void) | undefined;
    const stopWorker = (owned: OwnedFileWorker) => {
      try {
        const result = owned.terminate();
        if (result instanceof Promise) void result.catch(() => {});
      } catch {
        /* A failed termination cannot revive an already rejected job. */
      }
    };
    const finish = (error: Error | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancelled);
      unlisten?.();
      if (worker) stopWorker(worker);
      if (error) reject(error);
      else resolve(value!);
    };
    const cancelled = () => finish(new Error('File processing cancelled.'));
    const deadline = setTimeout(
      () => finish(new Error('File processing exceeded the 30-second deadline.')),
      30000,
    );
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) {
      cancelled();
      return;
    }
    Promise.resolve()
      .then(factory)
      .then((owned) => {
        if (settled) {
          stopWorker(owned);
          return;
        }
        worker = owned;
        unlisten = owned.listen(
          (value) => {
            if (settled || !value || typeof value !== 'object') return;
            const message = value as Record<string, unknown>;
            if (message.jobId !== jobId) return;
            if (message.ok === false) {
              finish(
                new Error(
                  typeof message.error === 'string'
                    ? message.error.slice(0, 512)
                    : 'File processing failed.',
                ),
              );
              return;
            }
            if (message.ok !== true) {
              finish(new Error('Malformed file-worker result.'));
              return;
            }
            try {
              finish(null, validate(message.value));
            } catch (error) {
              finish(error instanceof Error ? error : new Error('Invalid file result.'));
            }
          },
          (error) => finish(error),
        );
        const bytes =
          input.bytes.byteOffset === 0 && input.bytes.byteLength === input.bytes.buffer.byteLength
            ? input.bytes
            : new Uint8Array(input.bytes);
        owned.send({ jobId, ...input, bytes }, [bytes.buffer as ArrayBuffer]);
      })
      .catch((error) =>
        finish(error instanceof Error ? error : new Error('File worker unavailable.')),
      );
  });
}
