// Controlled public loading-task failure timing. No PDF parser/worker/geometry claim.
export const GlobalWorkerOptions = { workerSrc: 'source7-controlled-no-worker' };
export default 'source7-controlled-no-worker';
export const closeAttempts: number[] = [];
let rejectFirst: ((reason: unknown) => void) | undefined;
let rejected = false;
export function rejectFirstClose() {
  if (!rejectFirst || rejected) throw new Error('First actual loading-task close is not pending.');
  rejected = true;
  rejectFirst(new Error('Controlled previous PDF close failed.'));
}
export function closeSnapshot() { return { attempts: [...closeAttempts], rejected }; }
export function getDocument({ data }: { data: Uint8Array }) {
  const id = data[0];
  if (id !== 1 && id !== 2) throw new Error('Unexpected fixed PDF dependency operand.');
  const page = {
    view: [0, 0, 600, 800],
    getViewport({ scale }: { scale: number }) {
      return { width: 600 * scale, height: 800 * scale, rotation: 0, scale,
        convertToPdfPoint(x: number, y: number) { return [x / scale, 800 - y / scale]; } };
    },
    render({ canvasContext, viewport }: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) {
      return { cancel() {}, promise: Promise.resolve().then(() => {
        canvasContext.fillStyle = '#ddd'; canvasContext.fillRect(0, 0, viewport.width, viewport.height);
      }) };
    },
    cleanup() {},
  };
  return {
    promise: id === 1
      ? Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page) })
      : Promise.reject(new Error('Controlled replacement PDF read failed.')),
    destroy() {
      closeAttempts.push(id);
      return id === 1
        ? new Promise<void>((_resolve, reject) => { rejectFirst = reject; })
        : Promise.resolve();
    },
  };
}
