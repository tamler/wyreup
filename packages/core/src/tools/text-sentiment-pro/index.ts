import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type TextSentimentProParams = Record<string, never>;

export const defaultTextSentimentProParams: TextSentimentProParams = {};

export const textSentimentPro: ToolModule<TextSentimentProParams> = {
  id: 'text-sentiment-pro',
  slug: 'text-sentiment-pro',
  name: 'Sentiment (PRO)',
  description:
    'Hosted LLM sentiment classification — handles sarcasm, mixed tone, and domain language the in-browser heuristic misses. Returns positive / negative / neutral. Uses 1 credit per run.',
  category: 'text',
  keywords: ['sentiment', 'tone', 'classification', 'pro', 'llm', 'hosted'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 256 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],

  chainSuggestions: ['text-keywords', 'text-ner-pro'],

  defaults: defaultTextSentimentProParams,

  async run(
    inputs: File[],
    _params: TextSentimentProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-sentiment-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<{ sentiment: string }>(
      'text-sentiment-pro',
      { text, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
