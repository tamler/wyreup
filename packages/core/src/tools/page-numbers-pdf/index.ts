import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PageNumbersPdfParams } from './types.js';

export type { PageNumbersPdfParams } from './types.js';
export { defaultPageNumbersPdfParams } from './types.js';

const PageNumbersPdfComponentStub = (): unknown => null;

const VALID_POSITIONS = [
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'top-left',
  'top-center',
  'top-right',
] as const;

export const pageNumbersPdf: ToolModule<PageNumbersPdfParams> = {
  id: 'page-numbers-pdf',
  slug: 'page-numbers-pdf',
  name: 'Add Page Numbers',
  description: 'Draw page numbers on each page of a PDF at a configurable position.',
  category: 'pdf',
  presence: 'both',
  keywords: ['page numbers', 'pdf', 'number', 'footer', 'header', 'annotate'],

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
    position: 'bottom-center',
    fontSize: 12,
    startAt: 1,
    format: '{n}',
  },

  paramSchema: {
    position: {
      type: 'enum',
      label: 'position',
      options: [
        { value: 'bottom-left', label: 'bottom left' },
        { value: 'bottom-center', label: 'bottom center' },
        { value: 'bottom-right', label: 'bottom right' },
        { value: 'top-left', label: 'top left' },
        { value: 'top-center', label: 'top center' },
        { value: 'top-right', label: 'top right' },
      ],
    },
    fontSize: {
      type: 'range',
      label: 'font size',
      min: 6,
      max: 48,
      step: 1,
      unit: 'pt',
    },
    startAt: {
      type: 'number',
      label: 'start at',
      help: 'The number to print on the first page. Useful when continuing from another document.',
      min: 0,
      step: 1,
    },
    format: {
      type: 'string',
      label: 'format',
      placeholder: 'Page {n} of {total}',
      help: 'Template string. {n} = current page, {total} = total pages.',
    },
  },

  Component: PageNumbersPdfComponentStub,

  async run(
    inputs: File[],
    params: PageNumbersPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const position = params.position ?? 'bottom-center';
    if (!(VALID_POSITIONS as readonly string[]).includes(position)) {
      throw new Error(
        `Unknown position "${position}". Expected one of: ${VALID_POSITIONS.join(', ')}.`,
      );
    }

    const fontSize = params.fontSize ?? 12;
    const startAt = params.startAt ?? 1;
    const format = params.format ?? '{n}';
    const margin = 24;

    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    const buffer = await inputs[0]!.arrayBuffer();
    const doc = await PDFDocument.load(buffer);
    const pageCount = doc.getPageCount();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < pageCount; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / pageCount) * 90),
        message: `Numbering page ${i + 1} of ${pageCount}`,
      });

      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const label = format.replace('{n}', String(startAt + i));
      const textWidth = font.widthOfTextAtSize(label, fontSize);

      let x: number;
      let y: number;

      if (position === 'bottom-left') {
        x = margin;
        y = margin;
      } else if (position === 'bottom-center') {
        x = (width - textWidth) / 2;
        y = margin;
      } else if (position === 'bottom-right') {
        x = width - textWidth - margin;
        y = margin;
      } else if (position === 'top-left') {
        x = margin;
        y = height - fontSize - margin;
      } else if (position === 'top-center') {
        x = (width - textWidth) / 2;
        y = height - fontSize - margin;
      } else {
        // top-right
        x = width - textWidth - margin;
        y = height - fontSize - margin;
      }

      page.drawText(label, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
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
