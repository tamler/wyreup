import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBankPdfEnvironment } from '../../src/utilities/bank-pdf.js';

const library = vi.hoisted(() => ({
  create: vi.fn(),
  getDocument: vi.fn(),
  options: { workerSrc: '' },
}));

vi.mock('../../src/utilities/bank-pdf-platform.js', async () =>
  import('../../src/utilities/bank-pdf-node.js'),
);
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  PDFWorker: { create: library.create },
  GlobalWorkerOptions: library.options,
  getDocument: library.getDocument,
  OPS: Object.fromEntries([
    'stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke',
    'closeFillStroke', 'closeEOFillStroke', 'shadingFill', 'constructPath', 'rawFillPath',
    'paintXObject', 'paintImageMaskXObject', 'paintImageMaskXObjectGroup',
    'paintImageXObject', 'paintInlineImageXObject', 'paintInlineImageXObjectGroup',
    'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask',
  ].map((name, index) => [name, index])),
}));

const leftovers: Array<() => void> = [];
function pendingWorker(cleanupError?: Error) {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  leftovers.push(resolve);
  const destroy = vi.fn(() => {
    if (cleanupError) throw cleanupError;
  });
  library.create.mockReturnValue({ promise, destroy });
  return { resolve, reject, destroy };
}

afterEach(() => {
  for (const resolve of leftovers.splice(0)) resolve();
  vi.clearAllMocks();
});

describe('owned PDF worker readiness', () => {
  it('does not expose an environment that can be destroyed before worker readiness', async () => {
    const worker = pendingWorker();
    let returned = false;
    const creation = createBankPdfEnvironment().then((environment) => {
      returned = true;
      return environment;
    });
    try {
      await vi.waitFor(() => expect(library.create).toHaveBeenCalledOnce());
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(returned).toBe(false);
      expect(worker.destroy).not.toHaveBeenCalled();
    } finally {
      worker.resolve();
      const environment = await creation;
      await environment.destroy();
      await environment.destroy();
    }
    expect(worker.destroy).toHaveBeenCalledOnce();
    expect(library.getDocument).not.toHaveBeenCalled();
  });

  it('propagates readiness rejection and destroys its acquired worker once', async () => {
    const worker = pendingWorker();
    const initial = new Error('Synthetic worker initialization failure');
    const creation = createBankPdfEnvironment();
    await vi.waitFor(() => expect(library.create).toHaveBeenCalledOnce());
    worker.reject(initial);
    await expect(creation).rejects.toBe(initial);
    expect(worker.destroy).toHaveBeenCalledOnce();
    expect(library.getDocument).not.toHaveBeenCalled();
  });

  it('retains initialization and cleanup failures in their actual order', async () => {
    const cleanup = new Error('Synthetic worker cleanup failure');
    const worker = pendingWorker(cleanup);
    const initial = new Error('Synthetic worker initialization failure');
    const creation = createBankPdfEnvironment();
    await vi.waitFor(() => expect(library.create).toHaveBeenCalledOnce());
    worker.reject(initial);
    await expect(creation).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError && error.errors.length === 2 &&
      error.errors[0] === initial && error.errors[1] === cleanup,
    );
    expect(worker.destroy).toHaveBeenCalledOnce();
    expect(library.getDocument).not.toHaveBeenCalled();
  });
});
