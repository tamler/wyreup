import type { ToolModule, ToolRunContext } from '../../types.js';
import { parseRangeSpec } from '../../lib/pdf-ranges.js';

export interface PdfExtractPagesParams {
  /** Page numbers to extract (1-indexed). Can be individual numbers or ranges: [1, 3, "5-8", 10]. */
  pages: (number | string)[];
}

const PdfExtractPagesComponentStub = (): unknown => null;

export const pdfExtractPages: ToolModule<PdfExtractPagesParams> = {
  id: 'pdf-extract-pages',
  slug: 'pdf-extract-pages',
  name: 'Extract PDF Pages',
  description: 'Extract specific pages from a PDF into a new document.',
  category: 'edit',
  presence: 'both',
  keywords: ['pdf', 'extract', 'pages', 'select', 'subset'],

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
    pages: [1],
  },

  Component: PdfExtractPagesComponentStub,

  async run(
    inputs: File[],
    params: PdfExtractPagesParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const pages = params.pages;
    if (!pages || pages.length === 0) {
      throw new Error('pages must not be empty.');
    }

    const { PDFDocument } = await import('pdf-lib');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });
    const buffer = await inputs[0]!.arrayBuffer();
    const src = await PDFDocument.load(buffer);
    const pageCount = src.getPageCount();

    if (ctx.signal.aborted) throw new Error('Aborted');

    const pageNumbers = parseRangeSpec(pages, pageCount);

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Extracting pages' });

    const dest = await PDFDocument.create();
    // copyPages expects 0-indexed
    const copied = await dest.copyPages(src, pageNumbers.map((n) => n - 1));
    for (const page of copied) {
      dest.addPage(page);
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
    const bytes = await dest.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-multipage.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
