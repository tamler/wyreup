import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PdfToTextParams } from './types.js';

export type { PdfToTextParams } from './types.js';
export { defaultPdfToTextParams } from './types.js';

const PdfToTextComponentStub = (): unknown => null;

export const pdfToText: ToolModule<PdfToTextParams> = {
  id: 'pdf-to-text',
  slug: 'pdf-to-text',
  name: 'PDF to Text',
  description: 'Extract plain text from a PDF file.',
  category: 'export',
  presence: 'both',
  keywords: ['pdf', 'text', 'extract', 'ocr', 'read', 'parse'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: {
    separator: '\n\n=== Page {n} ===\n\n',
  },

  Component: PdfToTextComponentStub,

  async run(
    inputs: File[],
    params: PdfToTextParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const separator = params.separator ?? '\n\n=== Page {n} ===\n\n';
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });

    const { getDocument, GlobalWorkerOptions } = await import(
      'pdfjs-dist/legacy/build/pdf.mjs'
    );

    // In Node, resolve the worker path from disk so pdfjs can set up its
    // fake-worker fallback (it needs a non-empty string to pass its guard).
    // We use createRequire so this works in both Vitest and built ESM.
    if (typeof window === 'undefined') {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      try {
        const workerPath: string = require.resolve(
          'pdfjs-dist/legacy/build/pdf.worker.mjs',
        );
        GlobalWorkerOptions.workerSrc = workerPath;
      } catch {
        GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';
      }
    }

    const buffer = await input.arrayBuffer();
    const loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    const numPages = pdf.numPages;
    const pageParts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor(10 + (i / numPages) * 80),
        message: `Extracting text from page ${i}/${numPages}`,
      });

      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? (item.str ?? '') : ''))
        .join(' ')
        .replace(/ +/g, ' ')
        .trim();
      pageParts.push(pageText);
    }

    ctx.onProgress({ stage: 'encoding', percent: 95, message: 'Assembling text' });

    const parts: string[] = [];
    for (let i = 0; i < pageParts.length; i++) {
      if (i > 0) {
        parts.push(separator.replace('{n}', String(i + 1)));
      }
      parts.push(pageParts[i]!);
    }

    const text = parts.join('');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
