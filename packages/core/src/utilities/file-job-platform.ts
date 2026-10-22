import type { OwnedFileWorker } from './file-job.js';

export function createFileWorker(): Promise<OwnedFileWorker> {
  const worker = new Worker(new URL('./file-worker.js', import.meta.url), { type: 'module' });
  return Promise.resolve({
    send(message, transfer = []) {
      worker.postMessage(message, transfer);
    },
    listen(onMessage, onError) {
      const received = (event: MessageEvent<unknown>) => onMessage(event.data);
      const failed = (event: ErrorEvent) =>
        onError(new Error(event.message || 'File worker failed.'));
      const malformed = () => onError(new Error('File worker message could not be decoded.'));
      worker.addEventListener('message', received);
      worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', malformed);
      return () => {
        worker.removeEventListener('message', received);
        worker.removeEventListener('error', failed);
        worker.removeEventListener('messageerror', malformed);
      };
    },
    terminate() {
      worker.terminate();
    },
  });
}
