import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

export const analyzeChart: ToolModule<Record<string, never>> = {
  id: 'analyze-chart',
  slug: 'analyze-chart',
  name: 'Analyze Chart',
  description:
    'Reads a chart, graph, or diagram image and explains the data and main trend in plain text. Uses 1 credit per run.',
  category: 'export',
  keywords: ['chart', 'graph', 'diagram', 'analyze', 'data', 'pro', 'vision'],

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
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-translate-pro'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('analyze-chart accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ analysis: string }>(
      'analyze-chart',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.analysis], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
