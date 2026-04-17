import type { ToolModule, ToolRunContext } from '../../types.js';
import { parseRangeSpec } from '../../lib/pdf-ranges.js';
import { createCanvas, canvasToBlob } from '../../lib/canvas.js';

export interface PdfToImageParams {
  /** Output format. Default 'png'. */
  format?: 'png' | 'jpeg' | 'webp';
  /** DPI. Default 150. Higher = larger files. */
  dpi?: number;
  /** Page range (1-indexed). Default: all pages. */
  pages?: (number | string)[];
  /** JPEG/WebP quality, 1-100. Default 90. Ignored for PNG. */
  quality?: number;
}

const PdfToImageComponentStub = (): unknown => null;

const FORMAT_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const pdfToImage: ToolModule<PdfToImageParams> = {
  id: 'pdf-to-image',
  slug: 'pdf-to-image',
  name: 'PDF to Image',
  description: 'Render each page of a PDF as an image (PNG, JPEG, or WebP).',
  category: 'convert',
  presence: 'both',
  keywords: ['pdf', 'image', 'png', 'jpeg', 'webp', 'render', 'convert', 'pages'],

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
    format: 'png',
    dpi: 150,
    quality: 90,
  },

  Component: PdfToImageComponentStub,

  async run(
    inputs: File[],
    params: PdfToImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const format = params.format ?? 'png';
    const dpi = params.dpi ?? 150;
    const quality = params.quality ?? 90;
    const scale = dpi / 72;
    const mime = FORMAT_MIME[format] ?? 'image/png';

    if (!FORMAT_MIME[format]) {
      throw new Error(`Unknown format "${format}". Expected png, jpeg, or webp.`);
    }

    ctx.onProgress({ stage: 'processing', percent: 5, message: 'Loading PDF' });

    const { getDocument, GlobalWorkerOptions } = await import(
      'pdfjs-dist/legacy/build/pdf.mjs'
    );

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

    const buffer = await inputs[0]!.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const pageCount: number = pdf.numPages;

    let pageNumbers: number[];
    if (params.pages && params.pages.length > 0) {
      pageNumbers = parseRangeSpec(params.pages, pageCount);
    } else {
      pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
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

      const canvasContext = canvas.getContext('2d');

      await page.render({
        canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise;

      const qualityArg = format === 'png' ? undefined : quality / 100;
      const blob = await canvasToBlob(canvas, mime, qualityArg);
      outputs.push(blob);
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
