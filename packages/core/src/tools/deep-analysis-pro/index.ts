import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import { boundedText, ANALYSIS_TEXT_MAX_BYTES, ANALYSIS_QUESTION_MAX_BYTES } from '../../lib/pro-migration-limits.js';

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
    'Hosted analysis answers a question about your document and may cite passages. Document limit: 34,000 UTF-8 bytes; question limit: 1,500 bytes, including normalized forms. Check the answer against the source. Uses 3 credits per run.',
  category: 'text',
  keywords: ['analysis', 'reasoning', 'deepseek', 'contract', 'legal', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: ANALYSIS_TEXT_MAX_BYTES,
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
    boundedText(text, ANALYSIS_TEXT_MAX_BYTES, 'Document');
    boundedText(question, ANALYSIS_QUESTION_MAX_BYTES, 'Question');

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
