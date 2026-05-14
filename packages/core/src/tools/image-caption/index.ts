import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface ImageCaptionParams {
  /**
   * Maximum tokens to generate. Higher = longer captions, slower
   * inference. Default 30.
   */
  maxLength?: number;
}

export const defaultImageCaptionParams: ImageCaptionParams = {
  maxLength: 30,
};

// vit-gpt2 image captioning — Apache 2.0, ~100 MB.
// https://huggingface.co/Xenova/vit-gpt2-image-captioning
// Proven transformers.js support via the standard image-to-text
// pipeline. Florence-2 is the obvious Tier-2 upgrade once we've
// validated the install-group + first-load UX with this model.
const MODEL_ID = 'Xenova/vit-gpt2-image-captioning';

const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
];

export const imageCaption: ToolModule<ImageCaptionParams> = {
  id: 'image-caption',
  slug: 'image-caption',
  name: 'Describe Image',
  description:
    'Generate a plain-English description of any image. ' +
    '~100 MB model downloads on first use, then works offline.',
  category: 'export',
  keywords: [
    'caption', 'describe', 'image', 'alt-text', 'accessibility', 'vlm', 'vision',
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

  // A caption is prose. Suggest tools that work on prose, not on
  // arbitrary text/plain (color-converter, regex-tester, etc.).
  chainSuggestions: [
    'text-translate',
    'text-summarize',
    'text-sentiment',
    'text-readability',
    'text-stats',
    'markdown-to-html',
  ],
  outputDisplay: 'prose',

  defaults: defaultImageCaptionParams,

  paramSchema: {
    maxLength: {
      type: 'range',
      label: 'max length',
      help: 'Maximum tokens in the generated caption. Longer = slower.',
      min: 10,
      max: 80,
      step: 5,
    },
  },

  async run(
    inputs: File[],
    params: ImageCaptionParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('image-caption accepts exactly one image file.');
    }
    const input = inputs[0]!;

    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error(
        'image-caption requires a browser environment (URL.createObjectURL).',
      );
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'loading-deps',
      percent: 0,
      message: 'Loading captioning model (~100 MB on first use)',
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
      result = await pipe(url, { max_new_tokens: params.maxLength ?? 30 });
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
