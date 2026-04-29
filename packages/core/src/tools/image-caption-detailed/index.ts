import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface ImageCaptionDetailedParams {
  /**
   * Maximum tokens to generate. Higher = longer captions, slower
   * inference. Default 50 (BLIP can stretch farther than vit-gpt2's 30).
   */
  maxLength?: number;
}

export const defaultImageCaptionDetailedParams: ImageCaptionDetailedParams = {
  maxLength: 50,
};

// BLIP-base image captioning — BSD-3, ~250 MB quantized.
// https://huggingface.co/Xenova/blip-image-captioning-base
// Tier-2 quality upgrade on top of the existing vit-gpt2 image-caption
// tool. Same image-to-text pipeline, drop-in API.
const MODEL_ID = 'Xenova/blip-image-captioning-base';

const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
];

const ImageCaptionDetailedComponentStub = (): unknown => null;

export const imageCaptionDetailed: ToolModule<ImageCaptionDetailedParams> = {
  id: 'image-caption-detailed',
  slug: 'image-caption-detailed',
  name: 'Describe Image (Detailed)',
  description:
    'Generate a richer, more accurate description of any image using BLIP-base. ' +
    '~250 MB model downloads on first use, then works offline. ' +
    'Slower but more descriptive than the standard captioner.',
  category: 'export',
  presence: 'standalone',
  keywords: [
    'caption',
    'describe',
    'image',
    'alt-text',
    'accessibility',
    'vlm',
    'vision',
    'blip',
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
  installSize: 250_000_000,
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

  Component: ImageCaptionDetailedComponentStub,

  async run(
    inputs: File[],
    params: ImageCaptionDetailedParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('image-caption-detailed accepts exactly one image file.');
    }
    const input = inputs[0]!;

    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error(
        'image-caption-detailed requires a browser environment (URL.createObjectURL).',
      );
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'loading-deps',
      percent: 0,
      message: 'Loading BLIP captioning model (~250 MB on first use)',
    });

    const pipe = await getPipeline(
      ctx,
      'image-to-text',
      MODEL_ID,
    ) as (
      image: string,
      options?: Record<string, unknown>,
    ) => Promise<Array<{ generated_text: string }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 50,
      message: 'Generating caption',
    });

    const url = URL.createObjectURL(input);
    let result: Array<{ generated_text: string }>;
    try {
      result = await pipe(url, { max_new_tokens: params.maxLength ?? 50 });
    } finally {
      URL.revokeObjectURL(url);
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    const caption = Array.isArray(result)
      ? result[0]?.generated_text?.trim() ?? ''
      : '';
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
