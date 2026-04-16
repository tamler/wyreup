import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PdfInfoParams, PdfInfoResult } from './types.js';

export type { PdfInfoParams, PdfInfoResult } from './types.js';
export { defaultPdfInfoParams } from './types.js';

const PdfInfoComponentStub = (): unknown => null;

export const pdfInfo: ToolModule<PdfInfoParams> = {
  id: 'pdf-info',
  slug: 'pdf-info',
  name: 'PDF Info',
  description: 'Extract page count and metadata from a PDF.',
  category: 'inspect',
  presence: 'both',
  keywords: ['pdf', 'info', 'metadata', 'pages', 'inspect'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  Component: PdfInfoComponentStub,

  async run(
    inputs: File[],
    _params: PdfInfoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Reading PDF' });

    const { PDFDocument } = await import('pdf-lib');
    const buffer = await input.arrayBuffer();
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });

    const toIso = (d: Date | undefined): string | null =>
      d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null;

    const result: PdfInfoResult = {
      pageCount: doc.getPageCount(),
      bytes: buffer.byteLength,
      title: doc.getTitle() ?? null,
      author: doc.getAuthor() ?? null,
      subject: doc.getSubject() ?? null,
      producer: doc.getProducer() ?? null,
      creator: doc.getCreator() ?? null,
      createdAt: toIso(doc.getCreationDate()),
      modifiedAt: toIso(doc.getModificationDate()),
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['doc-a.pdf', 'doc-multipage.pdf'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
