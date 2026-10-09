import { parentPort, workerData } from 'node:worker_threads';
import { processJob } from './process-job.js';
import { safeError } from './limits.js';
import type { WorkerRequest } from './types.js';

if (!parentPort) throw new Error('This entry point requires an owned worker.');
const port = parentPort;
try {
  const result = await processJob(workerData as WorkerRequest);
  port.postMessage(result, result.ok ? [result.bytes] : []);
} catch (error) {
  const safe = safeError(error);
  port.postMessage({ ok: false, code: safe.code, ...(safe.target ? { target: safe.target } : {}) });
} finally {
  port.close();
}
