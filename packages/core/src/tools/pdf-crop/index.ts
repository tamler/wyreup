import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfCropBoxPerPage extends PdfCropBox {
  /** Page number (1-indexed). */
  page: number;
}

export interface PdfCropParams {
  /**
   * Crop box in PDF points. Can be:
   *   - A single object to apply the same crop to all pages.
   *   - An array of per-page objects specifying different crops per page.
   */
  box: PdfCropBox | PdfCropBoxPerPage[];
}

const PdfCropComponentStub = (): unknown => null;

function validateBox(box: PdfCropBox, label: string): void {
  if (box.width <= 0) throw new Error(`${label}: width must be greater than 0.`);
  if (box.height <= 0) throw new Error(`${label}: height must be greater than 0.`);
}

export const pdfCrop: ToolModule<PdfCropParams> = {
  id: 'pdf-crop',
  slug: 'pdf-crop',
  name: 'Crop PDF',
  description:
    'Crop PDF pages by setting the crop box. Modifies the viewing area without destroying content (reversible).',
  category: 'edit',
  presence: 'both',
  keywords: ['pdf', 'crop', 'trim', 'margins', 'pages'],

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
    box: { x: 0, y: 0, width: 595, height: 842 },
  },

  Component: PdfCropComponentStub,

  async run(
    inputs: File[],
    params: PdfCropParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { box } = params;
    if (!box) {
      throw new Error('box is required.');
    }

    const { PDFDocument } = await import('pdf-lib');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });
    const buffer = await inputs[0]!.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer);
    const pageCount = pdfDoc.getPageCount();

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Applying crop boxes' });

    if (Array.isArray(box)) {
      // Per-page crop
      for (const perPage of box) {
        if (perPage.page < 1 || perPage.page > pageCount) {
          throw new Error(
            `box references page ${perPage.page} but document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
          );
        }
        validateBox(perPage, `Page ${perPage.page} box`);
        const page = pdfDoc.getPage(perPage.page - 1);
        page.setCropBox(perPage.x, perPage.y, perPage.width, perPage.height);
      }
    } else {
      // Uniform crop across all pages
      validateBox(box, 'box');
      for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        page.setCropBox(box.x, box.y, box.width, box.height);
      }
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
