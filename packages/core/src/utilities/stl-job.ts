import { createFileWorker } from './file-job-platform.js';
import { runOwnedFileJob, type OwnedFileWorker, type StlFileJob } from './file-job.js';
import { validateStlJobResult, validateStlParams, type StlJobResult } from './stl-contours.js';

export function runStlFileJob(
  input: StlFileJob,
  signal: AbortSignal,
  factory: () => Promise<OwnedFileWorker> = createFileWorker,
): Promise<StlJobResult> {
  if (signal.aborted) return Promise.reject(new Error('STL conversion cancelled.'));
  if (
    !(input.bytes instanceof Uint8Array) ||
    !(input.bytes.buffer instanceof ArrayBuffer) ||
    input.bytes.byteLength > 20 * 1024 * 1024
  )
    return Promise.reject(new Error('STL input exceeds 20 MiB or is not owned bytes.'));
  const params = { ...validateStlParams(input.params) };
  return runOwnedFileJob(
    { ...input, bytes: new Uint8Array(input.bytes), params },
    signal,
    (value) => validateStlJobResult(value, params),
    factory,
  );
}
