import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TextSummarizeProParams {
  /** Free-form hint to the model (e.g. "3 bullets", "one sentence"). */
  style?: string;
}

export const defaultTextSummarizeProParams: TextSummarizeProParams = {
  style: '',
};

export const textSummarizePro: ToolModule<TextSummarizeProParams> = {
  id: 'text-summarize-pro',
  slug: 'text-summarize-pro',
  name: 'Summarize',
  description:
    'Higher-quality summarization powered by a hosted Llama-class model. Pairs well with transcribe-pro for "audio → notes" flows. Uses 2 credits per run.',
  category: 'text',
  keywords: ['summarize', 'summary', 'tldr', 'pro', 'llm', 'hosted'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro', 'text-sentences', 'text-keywords'],

  defaults: defaultTextSummarizeProParams,
  paramSchema: {
    style: {
      type: 'string',
      label: 'style hint',
      placeholder: '3 bullets / one sentence / executive summary',
      help: 'Optional. A short instruction the model follows when summarizing.',
    },
  },

  async run(inputs: File[], params: TextSummarizeProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-summarize-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<{ summary: string }>(
      'text-summarize-pro',
      { text, style: params.style?.trim() || undefined, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.summary], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
