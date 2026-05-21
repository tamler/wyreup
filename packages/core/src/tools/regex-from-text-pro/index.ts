import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface RegexFromTextProParams {
  description: string;
}

export const defaultRegexFromTextProParams: RegexFromTextProParams = { description: '' };

interface RegexFromTextProResult {
  pattern: string;
  flags: string;
  fullRegex: string;
  explanation: string;
}

export const regexFromTextPro: ToolModule<RegexFromTextProParams> = {
  id: 'regex-from-text-pro',
  slug: 'regex-from-text-pro',
  name: 'Regex From Text',
  description:
    'AI-generated regular expressions for descriptions the free heuristic engine cannot match. A hosted LLM handles arbitrary, open-ended phrasings. Uses 1 credit per run.',
  category: 'inspect',
  keywords: ['regex', 'regexp', 'natural language', 'pattern', 'generate', 'pro', 'ai', 'llm'],

  input: { accept: ['text/plain'], min: 0, max: 1, sizeLimit: 8 * 1024 },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'mono',

  chainSuggestions: ['regex-tester', 'regex-visualize', 'regex-explain'],

  defaults: defaultRegexFromTextProParams,
  paramSchema: {
    description: {
      type: 'string',
      label: 'description',
      placeholder: 'match order IDs: two letters, a dash, then six digits',
      help: "Plain English. The AI handles open-ended descriptions the free Regex From Text can't.",
      multiline: true,
    },
  },

  async run(
    inputs: File[],
    params: RegexFromTextProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    let description = params.description?.trim() ?? '';
    if (!description && inputs.length === 1) {
      description = (await inputs[0]!.text()).trim();
    }
    if (!description) throw new Error('Enter a description of what to match.');
    const result = await runPro<RegexFromTextProResult>(
      'regex-from-text-pro',
      { description },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
