import { parentPort } from 'node:worker_threads';
import { fileJobTransfers, handleFileJob } from './file-worker.js';

if (!parentPort) throw new Error('File worker requires its owned parent thread.');
const port = parentPort;
port.on('message', (message: unknown) => {
  void Promise.resolve(handleFileJob(message)).then((result) =>
    port.postMessage(result, fileJobTransfers(result)),
  );
});
