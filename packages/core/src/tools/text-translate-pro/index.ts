import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TextTranslateProParams {
  /** Target language. Plain name ("French", "Mandarin Chinese") or ISO code. */
  target?: string;
}

export const defaultTextTranslateProParams: TextTranslateProParams = {
  target: 'English',
};

export const textTranslatePro: ToolModule<TextTranslateProParams> = {
  id: 'text-translate-pro',
  slug: 'text-translate-pro',
  name: 'Translate',
  description:
    'Hosted Llama-class translation. Higher quality than browser-only models — particularly for less common language pairs. Uses 2 credits per run.',
  category: 'text',
  keywords: ['translate', 'translation', 'language', 'pro', 'llm', 'hosted'],

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
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-sentences', 'text-readability'],

  defaults: defaultTextTranslateProParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'target language',
      placeholder: 'English',
      help: 'Plain name (English, Spanish, Mandarin) or ISO code.',
    },
  },

  async run(
    inputs: File[],
    params: TextTranslateProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-translate-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    const target = (params.target ?? 'English').trim() || 'English';

    const result = await runPro<{ translation: string; target: string }>(
      'text-translate-pro',
      { text, target, fileName: inputs[0]!.name },
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
