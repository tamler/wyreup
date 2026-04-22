import type { ToolModule, ToolRunContext } from '../../types.js';
import type { RotatePdfParams } from './types.js';

export type { RotatePdfParams } from './types.js';
export { defaultRotatePdfParams } from './types.js';

const RotatePdfComponentStub = (): unknown => null;

/** Returns a Set of 0-indexed page indices to rotate based on the pages param. */
function resolvePageIndices(pages: string, pageCount: number): Set<number> {
  if (pages === 'all') {
    return new Set(Array.from({ length: pageCount }, (_, i) => i));
  }
  if (pages === 'odd') {
    // 1-indexed odd pages: 1, 3, 5, … → 0-indexed: 0, 2, 4, …
    const s = new Set<number>();
    for (let i = 0; i < pageCount; i += 2) s.add(i);
    return s;
  }
  if (pages === 'even') {
    // 1-indexed even pages: 2, 4, 6, … → 0-indexed: 1, 3, 5, …
    const s = new Set<number>();
    for (let i = 1; i < pageCount; i += 2) s.add(i);
    return s;
  }

  // Comma-separated 1-indexed page numbers
  const parts = pages.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('pages must not be empty. Use "all", "odd", "even", or a comma-separated list.');
  }
  const indices = new Set<number>();
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || String(n) !== part) {
      throw new Error(
        `Invalid page specifier "${part}". Expected a number, "all", "odd", or "even".`,
      );
    }
    if (n < 1 || n > pageCount) {
      throw new Error(
        `Page ${n} is out of range for a ${pageCount}-page PDF. Pages are 1-indexed.`,
      );
    }
    indices.add(n - 1);
  }
  return indices;
}

export const rotatePdf: ToolModule<RotatePdfParams> = {
  id: 'rotate-pdf',
  slug: 'rotate-pdf',
  name: 'Rotate PDF',
  description: 'Rotate all or selected pages of a PDF by 90, 180, or 270 degrees.',
  category: 'pdf',
  presence: 'both',
  keywords: ['rotate', 'pdf', 'pages', 'orientation', 'landscape', 'portrait'],

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

  defaults: { degrees: 90, pages: 'all' },

  paramSchema: {
    degrees: {
      type: 'enum',
      label: 'degrees',
      options: [
        { value: 90, label: '90°' },
        { value: 180, label: '180°' },
        { value: 270, label: '270°' },
      ],
    },
    pages: {
      type: 'enum',
      label: 'pages',
      options: [
        { value: 'all', label: 'All pages' },
        { value: 'odd', label: 'Odd pages' },
        { value: 'even', label: 'Even pages' },
      ],
    },
  },

  Component: RotatePdfComponentStub,

  async run(
    inputs: File[],
    params: RotatePdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const deg = params.degrees;
    if (deg !== 90 && deg !== 180 && deg !== 270) {
      throw new Error(`Invalid degrees "${String(deg)}". Must be 90, 180, or 270.`);
    }

    const { PDFDocument, degrees } = await import('pdf-lib');

    const buffer = await inputs[0]!.arrayBuffer();
    const doc = await PDFDocument.load(buffer);
    const pageCount = doc.getPageCount();

    const toRotate = resolvePageIndices(params.pages ?? 'all', pageCount);

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Applying rotation' });

    for (const idx of toRotate) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const page = doc.getPage(idx);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + deg) % 360));
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
    const bytes = await doc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-multipage.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
