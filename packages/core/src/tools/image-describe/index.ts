import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

export const imageDescribe: ToolModule<Record<string, never>> = {
  id: 'image-describe',
  slug: 'image-describe',
  name: 'Describe Image',
  description:
    'Generates a concise description / alt-text for an image using a hosted vision model. Output is plain text. Uses 1 credit per run.',
  category: 'export',
  keywords: ['describe', 'caption', 'alt-text', 'accessibility', 'pro', 'vision'],

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

  chainSuggestions: ['text-translate-pro', 'text-summarize-pro'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('image-describe accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ description: string }>(
      'image-describe',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.description], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
