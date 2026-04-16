import type { ToolModule, ToolRunContext } from '../../types.js';
import type { MergePdfParams } from './types.js';

export type { MergePdfParams } from './types.js';
export { defaultMergePdfParams } from './types.js';

const MergePdfComponentStub = (): unknown => null;

export const mergePdf: ToolModule<MergePdfParams> = {
  id: 'merge-pdf',
  slug: 'merge-pdf',
  name: 'Merge PDFs',
  description: 'Combine multiple PDF files into a single document.',
  category: 'pdf',
  presence: 'both',
  keywords: ['merge', 'pdf', 'combine', 'concatenate', 'join'],

  input: {
    accept: ['application/pdf'],
    min: 2,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  Component: MergePdfComponentStub,

  async run(
    inputs: File[],
    _params: MergePdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Reading ${input.name} (${i + 1}/${inputs.length})`,
      });

      const buffer = await input.arrayBuffer();
      const src = await PDFDocument.load(buffer);
      const copiedPages = await merged.copyPages(src, src.getPageIndices());
      for (const page of copiedPages) {
        merged.addPage(page);
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving merged PDF' });
    const bytes = await merged.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf', 'doc-b.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
