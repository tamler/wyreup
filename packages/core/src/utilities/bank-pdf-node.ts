import { createRequire } from 'node:module';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';

export function createBankPdfWorker(library: Pick<typeof PdfJs, 'PDFWorker' | 'GlobalWorkerOptions'>) {
  library.GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const worker = library.PDFWorker.create({});
  let destroyed = false;
  return { worker, destroy() {
    if (destroyed) return;
    destroyed = true;
    worker.destroy();
  } };
}
