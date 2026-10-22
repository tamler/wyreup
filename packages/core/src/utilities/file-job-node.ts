import { Worker } from 'node:worker_threads';
import type { OwnedFileWorker } from './file-job.js';

export function createFileWorker(): Promise<OwnedFileWorker> {
  const target = new URL('./file-worker.js', import.meta.url);
  const stringInput = process.execArgv.some(
    (arg) => arg === '--input-type' || arg.startsWith('--input-type='),
  );
  const worker = stringInput
    ? new Worker(`import(${JSON.stringify(target.href)})`, { eval: true })
    : new Worker(target);
  return Promise.resolve({
    send(message, transfer = []) {
      worker.postMessage(message, transfer);
    },
    listen(onMessage, onError) {
      const received = (value: unknown) => onMessage(value);
      const failed = (error: Error) => onError(error);
      const exited = (code: number) =>
        onError(new Error(`File worker exited before a result (${code}).`));
      worker.on('message', received);
      worker.on('error', failed);
      worker.on('exit', exited);
      return () => {
        worker.off('message', received);
        worker.off('error', failed);
        worker.off('exit', exited);
      };
    },
    terminate() {
      return worker.terminate();
    },
  });
}
