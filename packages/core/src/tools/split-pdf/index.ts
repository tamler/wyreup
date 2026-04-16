import type { ToolModule, ToolRunContext } from '../../types.js';
import type { SplitPdfParams } from './types.js';

export type { SplitPdfParams } from './types.js';
export { defaultSplitPdfParams } from './types.js';

const SplitPdfComponentStub = (): unknown => null;

/**
 * Parse a ranges string like "1-3,5,7-9" into arrays of 0-indexed page
 * indices. Each element of the returned array becomes a separate output PDF.
 */
function parseRanges(rangesStr: string, pageCount: number): number[][] {
  const parts = rangesStr.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('ranges must not be empty when mode is "ranges".');
  }

  return parts.map((part) => {
    const dashMatch = part.match(/^(\d+)-(\d+)$/);
    if (dashMatch) {
      const start = parseInt(dashMatch[1]!, 10);
      const end = parseInt(dashMatch[2]!, 10);
      if (start < 1 || end < start || end > pageCount) {
        throw new Error(
          `Range "${part}" is invalid for a ${pageCount}-page PDF. Pages are 1-indexed.`,
        );
      }
      const indices: number[] = [];
      for (let p = start; p <= end; p++) {
        indices.push(p - 1);
      }
      return indices;
    }

    const singleMatch = part.match(/^(\d+)$/);
    if (singleMatch) {
      const n = parseInt(singleMatch[1]!, 10);
      if (n < 1 || n > pageCount) {
        throw new Error(
          `Page ${n} is out of range for a ${pageCount}-page PDF. Pages are 1-indexed.`,
        );
      }
      return [n - 1];
    }

    throw new Error(
      `Invalid range "${part}". Expected a number or a range like "2-5".`,
    );
  });
}

export const splitPdf: ToolModule<SplitPdfParams> = {
  id: 'split-pdf',
  slug: 'split-pdf',
  name: 'Split PDF',
  description: 'Split a PDF into separate files by page or custom ranges.',
  category: 'pdf',
  presence: 'both',
  keywords: ['split', 'pdf', 'pages', 'extract', 'separate'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
    multiple: true,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { mode: 'all' },

  Component: SplitPdfComponentStub,

  async run(
    inputs: File[],
    params: SplitPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const mode = params.mode ?? 'all';
    const { PDFDocument } = await import('pdf-lib');

    const buffer = await inputs[0]!.arrayBuffer();
    const src = await PDFDocument.load(buffer);
    const pageCount = src.getPageCount();

    if (pageCount === 0) {
      throw new Error('The input PDF has no pages.');
    }

    let groups: number[][];
    if (mode === 'all') {
      groups = Array.from({ length: pageCount }, (_, i) => [i]);
    } else if (mode === 'ranges') {
      const rangesStr = params.ranges ?? '';
      if (!rangesStr.trim()) {
        throw new Error('ranges must be provided when mode is "ranges".');
      }
      groups = parseRanges(rangesStr, pageCount);
    } else {
      throw new Error(`Unknown mode "${mode as string}". Expected "all" or "ranges".`);
    }

    const blobs: Blob[] = [];
    for (let g = 0; g < groups.length; g++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((g / groups.length) * 90),
        message: `Creating part ${g + 1} of ${groups.length}`,
      });

      const part = await PDFDocument.create();
      const copied = await part.copyPages(src, groups[g]!);
      for (const page of copied) {
        part.addPage(page);
      }
      const bytes = await part.save();
      blobs.push(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return blobs;
  },

  __testFixtures: {
    valid: ['doc-multipage.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
