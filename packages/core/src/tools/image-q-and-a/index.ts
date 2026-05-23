import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

export interface ImageQandAParams {
  question: string;
}

export const defaultImageQandAParams: ImageQandAParams = { question: '' };

export const imageQandA: ToolModule<ImageQandAParams> = {
  id: 'image-q-and-a',
  slug: 'image-q-and-a',
  name: 'Ask About Image',
  description:
    'Ask a question about an image and get an answer from a hosted vision model. Uses 1 credit per run.',
  category: 'export',
  keywords: ['question', 'answer', 'vqa', 'image', 'ask', 'pro', 'vision'],

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
  creditCost: 1,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro'],

  defaults: defaultImageQandAParams,
  paramSchema: {
    question: {
      type: 'string',
      label: 'question',
      placeholder: 'What is written on the sign?',
      help: 'The question to ask about the uploaded image.',
    },
  },

  async run(
    inputs: File[],
    params: ImageQandAParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('image-q-and-a accepts exactly one image.');
    const question = params.question?.trim();
    if (!question) throw new Error('A question is required.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ answer: string }>(
      'image-q-and-a',
      { imageBase64, question, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.answer], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
