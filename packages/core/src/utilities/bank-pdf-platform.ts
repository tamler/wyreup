import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';

export function createBankPdfWorker(library: Pick<typeof PdfJs, 'PDFWorker' | 'GlobalWorkerOptions'>) {
  if (typeof Worker !== 'function') throw new Error('This browser requires dedicated PDF workers.');
  const port = new Worker(new URL('./bank-pdf-worker.js', import.meta.url), { type: 'module' });
  try {
    const worker = library.PDFWorker.create({ port });
    let destroyed = false;
    return { worker, destroy() {
      if (destroyed) return;
      destroyed = true;
      try { worker.destroy(); } finally { port.terminate(); }
    } };
  } catch (error) { port.terminate(); throw error; }
}
