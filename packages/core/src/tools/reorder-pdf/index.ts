import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ReorderPdfParams } from './types.js';

export type { ReorderPdfParams } from './types.js';
export { defaultReorderPdfParams } from './types.js';

/** Parse a comma-separated 1-indexed order string into 0-indexed indices. */
function parseOrder(order: string, pageCount: number): number[] {
  if (!order.trim()) {
    throw new Error('order must not be empty.');
  }

  const parts = order.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('order must not be empty.');
  }

  return parts.map((part) => {
    const n = parseInt(part, 10);
    if (isNaN(n) || String(n) !== part) {
      throw new Error(`Invalid page number "${part}" in order. Expected a positive integer.`);
    }
    if (n < 1 || n > pageCount) {
      throw new Error(
        `Page ${n} is out of range for a ${pageCount}-page PDF. Pages are 1-indexed.`,
      );
    }
    return n - 1;
  });
}

export const reorderPdf: ToolModule<ReorderPdfParams> = {
  id: 'reorder-pdf',
  slug: 'reorder-pdf',
  name: 'Reorder PDF Pages',
  description: 'Rearrange, duplicate, or remove pages in a PDF using a custom order.',
  category: 'pdf',
  keywords: ['reorder', 'rearrange', 'pdf', 'pages', 'order', 'sort'],

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

  defaults: { order: '' },

  async run(
    inputs: File[],
    params: ReorderPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { PDFDocument } = await import('pdf-lib');

    const buffer = await inputs[0]!.arrayBuffer();
    const src = await PDFDocument.load(buffer);
    const pageCount = src.getPageCount();

    const indices = parseOrder(params.order ?? '', pageCount);

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reordering pages' });

    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    for (const page of copied) {
      out.addPage(page);
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
    const bytes = await out.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-multipage.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
