import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfRedactRectangle {
  /** Page number (1-indexed). */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfRedactParams {
  /**
   * Rectangles to redact. Coordinates in PDF points (1pt = 1/72 inch).
   * Each rectangle specifies its target page (1-indexed).
   */
  rectangles: PdfRedactRectangle[];
  /**
   * Redaction fill color as RGB 0-1. Default black [0, 0, 0].
   */
  color?: [number, number, number];
}

const PdfRedactComponentStub = (): unknown => null;

export const pdfRedact: ToolModule<PdfRedactParams> = {
  id: 'pdf-redact',
  slug: 'pdf-redact',
  name: 'Redact PDF',
  description:
    'Permanently cover content in a PDF with solid rectangles. ' +
    'Underlying text objects may still be extractable by specialized tools. ' +
    'For forensic-grade redaction, flatten the output via pdf-compress after redacting.',
  category: 'edit',
  presence: 'both',
  keywords: ['pdf', 'redact', 'cover', 'hide', 'privacy', 'black'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    rectangles: [],
    color: [0, 0, 0],
  },

  Component: PdfRedactComponentStub,

  async run(
    inputs: File[],
    params: PdfRedactParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { rectangles, color = [0, 0, 0] } = params;

    if (!rectangles || rectangles.length === 0) {
      throw new Error('rectangles must not be empty.');
    }

    const { PDFDocument, rgb } = await import('pdf-lib');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });
    const buffer = await inputs[0]!.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer);
    const pageCount = pdfDoc.getPageCount();

    if (ctx.signal.aborted) throw new Error('Aborted');

    const [r, g, b] = color;
    const fillColor = rgb(r, g, b);

    for (const rect of rectangles) {
      if (rect.page < 1 || rect.page > pageCount) {
        throw new Error(
          `Rectangle references page ${rect.page} but document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        );
      }

      const page = pdfDoc.getPage(rect.page - 1);
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: fillColor,
      });
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
    const bytes = await pdfDoc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
