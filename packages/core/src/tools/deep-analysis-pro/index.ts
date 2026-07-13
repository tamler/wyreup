import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface DeepAnalysisProParams {
  question: string;
}

export const defaultDeepAnalysisProParams: DeepAnalysisProParams = { question: '' };

interface AnalysisResult {
  answer: string;
  reasoning: string;
}

export const deepAnalysisPro: ToolModule<DeepAnalysisProParams> = {
  id: 'deep-analysis-pro',
  slug: 'deep-analysis-pro',
  name: 'Deep Analysis',
  description:
    'Hosted DeepSeek R1 reasoning model — reads your document and answers a specific question with explicit step-by-step reasoning. Suited to contracts, legal text, code review, and root-cause analysis from logs. Uses 3 credits per run.',
  category: 'text',
  keywords: ['analysis', 'reasoning', 'deepseek', 'r1', 'contract', 'legal', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 512 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 3,
  memoryEstimate: 'low',

  chainSuggestions: ['json-formatter', 'json-yaml', 'json-flatten'],

  defaults: defaultDeepAnalysisProParams,
  paramSchema: {
    question: {
      type: 'string',
      label: 'question',
      placeholder: 'What termination conditions apply?',
      help: 'The specific question to reason about.',
      multiline: true,
    },
  },

  async run(inputs: File[], params: DeepAnalysisProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('deep-analysis-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    const question = params.question?.trim();
    if (!question) throw new Error('Enter a question.');

    const result = await runPro<AnalysisResult>(
      'deep-analysis-pro',
      { text, question, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
