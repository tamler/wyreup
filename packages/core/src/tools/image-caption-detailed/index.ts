import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';
import { transformerImage } from '../../lib/transformer-image.js';

export interface ImageCaptionDetailedParams {
  /**
   * Maximum tokens to generate. Higher = longer captions, slower
   * inference. Default 50.
   */
  maxLength?: number;
}

export const defaultImageCaptionDetailedParams: ImageCaptionDetailedParams = {
  maxLength: 50,
};

// Use the standard captioning model with a larger generation budget.
// Hosted model availability is verified separately from this configuration.
export const IMAGE_CAPTION_DETAILED_MODEL_ID = 'Xenova/vit-gpt2-image-captioning';

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

export const imageCaptionDetailed: ToolModule<ImageCaptionDetailedParams> = {
  id: 'image-caption-detailed',
  slug: 'image-caption-detailed',
  name: 'Describe Image (Detailed)',
  description:
    'Generate a longer description of an image with a larger caption budget. ' +
    'The model downloads on first use, then works offline.',
  category: 'export',
  keywords: [
    'caption',
    'describe',
    'image',
    'alt-text',
    'accessibility',
    'vlm',
    'vision',
    'detailed',
  ],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 100_000_000,
  installGroup: 'vision-llm',
  requires: { webgpu: 'preferred' },

  // Captions are prose. Suggest tools that work on prose.
  chainSuggestions: [
    'text-translate',
    'text-summarize',
    'text-sentiment',
    'text-readability',
    'text-stats',
    'markdown-to-html',
  ],
  outputDisplay: 'prose',

  defaults: defaultImageCaptionDetailedParams,

  paramSchema: {
    maxLength: {
      type: 'range',
      label: 'max length',
      help: 'Maximum tokens in the generated caption. Longer = slower.',
      min: 10,
      max: 120,
      step: 10,
    },
  },

  async run(
    inputs: File[],
    params: ImageCaptionDetailedParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('image-caption-detailed accepts exactly one image file.');
    }
    const input = inputs[0]!;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'loading-deps',
      percent: 0,
      message: 'Loading captioning model (~100 MB on first use)',
    });

    const pipe = (await getPipeline(ctx, 'image-to-text', IMAGE_CAPTION_DETAILED_MODEL_ID)) as (
      image: unknown,
      options?: Record<string, unknown>,
    ) => Promise<Array<{ generated_text: string }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 50,
      message: 'Generating caption',
    });

    const image = await transformerImage(input);
    const result = await pipe(image, { max_new_tokens: params.maxLength ?? 50 });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const caption = Array.isArray(result) ? (result[0]?.generated_text?.trim() ?? '') : '';
    if (!caption) {
      throw new Error('No caption generated.');
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([caption], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
