import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PdfToImageParams } from './types.js';
import { createCanvas, canvasToBlob } from '../../lib/canvas.js';

export type { PdfToImageParams } from './types.js';
export { defaultPdfToImageParams } from './types.js';

const PdfToImageComponentStub = (): unknown => null;

/**
 * Parse the pages param into a sorted array of 1-indexed page numbers.
 * Returns null when value is 'all' (caller uses full page range).
 */
function parsePages(pages: string, pageCount: number): number[] | null {
  if (pages === 'all') return null;

  const nums = pages
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = parseInt(s, 10);
      if (isNaN(n)) throw new Error(`Invalid page number "${s}".`);
      return n;
    });

  for (const n of nums) {
    if (n < 1 || n > pageCount) {
      throw new Error(
        `Page number ${n} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'}).`,
      );
    }
  }

  return nums;
}

export const pdfToImage: ToolModule<PdfToImageParams> = {
  id: 'pdf-to-image',
  slug: 'pdf-to-image',
  name: 'PDF to Image',
  description: 'Render each page of a PDF as a PNG image.',
  category: 'convert',
  presence: 'both',
  keywords: ['pdf', 'image', 'png', 'render', 'convert', 'page'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/png',
    multiple: true,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',

  defaults: {
    dpi: 150,
    pages: 'all',
  },

  Component: PdfToImageComponentStub,

  async run(
    inputs: File[],
    params: PdfToImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const dpi = params.dpi ?? 150;
    const pagesParam = params.pages ?? 'all';
    const scale = dpi / 72;

    ctx.onProgress({ stage: 'processing', percent: 5, message: 'Loading PDF' });

    const input = inputs[0]!;

    const { getDocument, GlobalWorkerOptions } = await import(
      'pdfjs-dist/legacy/build/pdf.mjs'
    );

    // Same worker setup as pdf-to-text: resolve from disk in Node.
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
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;

    const pageCount: number = pdf.numPages;

    let pageNumbers: number[];
    const parsed = parsePages(pagesParam, pageCount);
    if (parsed === null) {
      pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
    } else {
      pageNumbers = parsed;
    }

    const outputs: Blob[] = [];

    for (let idx = 0; idx < pageNumbers.length; idx++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const pageNum = pageNumbers[idx]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor(10 + (idx / pageNumbers.length) * 80),
        message: `Rendering page ${pageNum}/${pageCount}`,
      });

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = await createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );

      // pdfjs needs the raw canvas object, not our typed wrapper.
      // We pass canvas as unknown then let pdfjs use it.
      const canvasContext = canvas.getContext('2d');

      await page.render({
        canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise;

      const pngBlob = await canvasToBlob(canvas, 'image/png');
      outputs.push(pngBlob);
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};
