import { fileJobTransfers, handleFileJob } from './file-worker.js';

const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};
scope.addEventListener('message', (event) => {
  void Promise.resolve(handleFileJob(event.data)).then((result) =>
    scope.postMessage(result, fileJobTransfers(result)),
  );
});
