import process from 'node:process';
import { parentPort, workerData } from 'node:worker_threads';

process.stdout.write('WORKER_STDOUT_PRIVATE_CANARY');
process.stderr.write('WORKER_STDERR_PRIVATE_CANARY');
/** @type {unknown} */
const input = workerData;
const fields = input && typeof input === 'object' ? Object.keys(input).sort().join(',') : '';
const scrubbed = Object.keys(process.env).length === 0 &&
  fields === 'allowDownscale,inputs,operation,targetKb';
parentPort?.postMessage({ ok: false, code: scrubbed ? 'INVALID_FILE' : 'PROCESSING_FAILED' });
parentPort?.close();
