import type { ToolModule, ToolRunContext } from '../../types.js';
import type { OcrParams } from './types.js';

export type { OcrParams } from './types.js';
export { defaultOcrParams } from './types.js';

const OcrComponentStub = (): unknown => null;

const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
];

export const ocr: ToolModule<OcrParams> = {
  id: 'ocr',
  slug: 'ocr',
  name: 'OCR',
  description: 'Extract text from images using optical character recognition.',
  category: 'export',
  presence: 'both',
  keywords: ['ocr', 'text', 'extract', 'image', 'recognition', 'scan', 'read'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'high',

  defaults: {
    language: 'eng',
  },

  Component: OcrComponentStub,

  async run(
    inputs: File[],
    params: OcrParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    // Validate input MIME types
    for (const input of inputs) {
      if (!ACCEPTED_MIME_TYPES.includes(input.type)) {
        throw new Error(`Unsupported input type: ${input.type}. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`);
      }
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading OCR engine' });

    const { createWorker } = await import('tesseract.js');
    const language = params.language ?? 'eng';
    const worker = await createWorker(language);

    const results: string[] = [];

    try {
      for (let i = 0; i < inputs.length; i++) {
        if (ctx.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        ctx.onProgress({
          stage: 'processing',
          percent: Math.round((i / inputs.length) * 80),
          message: `Recognizing ${i + 1} of ${inputs.length}`,
        });

        const ab = await inputs[i]!.arrayBuffer();
        const { data: { text } } = await worker.recognize(Buffer.from(ab));
        results.push(text.trim());
      }
    } finally {
      await worker.terminate();
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    const output = results.join('\n\n---\n\n');
    return [new Blob([output], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
