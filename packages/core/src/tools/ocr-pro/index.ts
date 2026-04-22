import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OcrProParams {
  // No configurable params for v1.
  // Future: model?: 'handwritten' | 'printed', maxLength?: number
}

export const defaultOcrProParams: OcrProParams = {};

// TrOCR-small handwritten — MIT licensed, ~150 MB quantized
// https://huggingface.co/Xenova/trocr-small-handwritten
// This model handles both handwriting and printed text.
// The existing tesseract-based `ocr` tool handles simpler printed cases.
const MODEL_ID = 'Xenova/trocr-small-handwritten';

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const OcrProComponentStub = (): unknown => null;

export const ocrPro: ToolModule<OcrProParams> = {
  id: 'ocr-pro',
  slug: 'ocr-pro',
  name: 'OCR Pro',
  description: 'Extract text from handwritten notes and printed documents using a neural model — runs on your device.',
  category: 'export',
  presence: 'both',
  keywords: ['ocr', 'handwriting', 'text', 'extract', 'recognize', 'neural', 'scan', 'document'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    max: 1,
    sizeLimit: 20 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 150_000_000, // ~150 MB quantized TrOCR-small
  installGroup: 'image-ai',
  requires: { webgpu: 'preferred' },

  defaults: defaultOcrProParams,
  Component: OcrProComponentStub,

  async run(inputs: File[], _params: OcrProParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('ocr-pro accepts exactly one image file.');
    }
    const input = inputs[0]!;
    if (!ACCEPTED_MIME_TYPES.includes(input.type)) {
      throw new Error(
        `Unsupported input type: ${input.type}. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`,
      );
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading neural OCR model' });

    const pipe = await getPipeline(ctx, 'image-to-text', MODEL_ID) as (
      input: unknown,
    ) => Promise<Array<{ generated_text?: string }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Recognizing text' });

    const arrayBuffer = await input.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: input.type });
    const dataUrl = await blobToDataUrl(blob);

    const result = await pipe(dataUrl);

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = Array.isArray(result)
      ? result.map((r) => r.generated_text ?? '').join('\n')
      : String(result);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([text], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: ['photo.jpg'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${blob.type};base64,${b64}`;
}
