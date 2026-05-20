import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

export interface TranslateImageParams {
  target: string;
}

export const defaultTranslateImageParams: TranslateImageParams = { target: 'English' };

export const translateImage: ToolModule<TranslateImageParams> = {
  id: 'translate-image',
  slug: 'translate-image',
  name: 'Translate Image Text (PRO)',
  description:
    'Extracts text from an image and translates it. Photograph a sign or document, get the translation. Uses 3 credits per run.',
  category: 'export',
  keywords: ['translate', 'image', 'ocr', 'sign', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 3,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-sentences'],

  defaults: defaultTranslateImageParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'translate to',
      placeholder: 'English',
      help: 'The language to translate the image text into.',
    },
  },

  async run(
    inputs: File[],
    params: TranslateImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('translate-image accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ translation: string; target: string }>(
      'translate-image',
      { imageBase64, target: params.target?.trim() || 'English', fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.translation], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
