import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type ContentSafetyProParams = Record<string, never>;

export const defaultContentSafetyProParams: ContentSafetyProParams = {};

interface SafetyResult {
  safe: boolean;
  categories: string[];
  raw: string;
}

export const contentSafetyPro: ToolModule<ContentSafetyProParams> = {
  id: 'content-safety-pro',
  slug: 'content-safety-pro',
  name: 'Content Safety',
  description:
    'Hosted Llama Guard classifier — flags text containing violence, sexual content, hate speech, self-harm, harassment, and 9 other categories. Useful for moderators, parents, and anyone shipping user-generated content. Uses 1 credit per run.',
  category: 'privacy',
  keywords: ['safety', 'moderation', 'classify', 'guard', 'pii', 'pro', 'llm'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 64 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',

  chainSuggestions: ['text-redact-pro', 'text-sentiment-pro'],

  defaults: defaultContentSafetyProParams,

  async run(
    inputs: File[],
    _params: ContentSafetyProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('content-safety-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<SafetyResult>(
      'content-safety-pro',
      { text, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
