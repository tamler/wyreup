import type { ToolModule, ToolRunContext } from '../../types.js';
import { parseRangeSpec } from '../../lib/pdf-ranges.js';

export interface PdfDeletePagesParams {
  /** Page numbers to remove (1-indexed). Can be individual numbers or ranges: [2, "5-7"]. */
  pages: (number | string)[];
}

export const pdfDeletePages: ToolModule<PdfDeletePagesParams> = {
  id: 'pdf-delete-pages',
  slug: 'pdf-delete-pages',
  name: 'Delete PDF Pages',
  description: 'Remove specific pages from a PDF.',
  category: 'edit',
  keywords: ['pdf', 'delete', 'remove', 'pages'],

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
    pages: [],
  },

  async run(
    inputs: File[],
    params: PdfDeletePagesParams,
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

    const toDelete = new Set(parseRangeSpec(pages, pageCount));

    if (toDelete.size >= pageCount) {
      throw new Error('Cannot delete all pages — the output must have at least 1 page.');
    }

    // Compute complement: pages to keep (1-indexed)
    const toKeep: number[] = [];
    for (let i = 1; i <= pageCount; i++) {
      if (!toDelete.has(i)) {
        toKeep.push(i);
      }
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Rebuilding PDF' });

    const dest = await PDFDocument.create();
    const copied = await dest.copyPages(src, toKeep.map((n) => n - 1));
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
