import { createFileWorker } from './file-job-platform.js';
import { runOwnedFileJob, type OwnedFileWorker } from './file-job.js';
import { validateBankDocument, BANK_LIMITS, type BankDocument } from './bank-statement.js';

export interface BankFileJob {
  type: 'bank-extract';
  bytes: Uint8Array;
  params: { rowTolerance: number };
}
export function runBankFileJob(
  input: BankFileJob, signal: AbortSignal,
  factory: () => Promise<OwnedFileWorker> = createFileWorker,
): Promise<BankDocument> {
  if (signal.aborted) return Promise.reject(new Error('Bank statement extraction cancelled.'));
  if (!(input.bytes instanceof Uint8Array) || !(input.bytes.buffer instanceof ArrayBuffer) || input.bytes.byteLength < 5 || input.bytes.byteLength > BANK_LIMITS.inputBytes)
    return Promise.reject(new Error('Select a PDF of at most 20 MiB.'));
  if (!input.params || Object.keys(input.params).join(',') !== 'rowTolerance' ||
      typeof input.params.rowTolerance !== 'number' || !Number.isFinite(input.params.rowTolerance) ||
      input.params.rowTolerance < 0.5 || input.params.rowTolerance > 5)
    return Promise.reject(new Error('Row tolerance must be 0.5 to 5 PDF points.'));
  return runOwnedFileJob({ type: 'bank-extract', bytes: new Uint8Array(input.bytes), params: { rowTolerance: input.params.rowTolerance } }, signal, validateBankDocument, factory);
}
