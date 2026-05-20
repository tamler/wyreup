import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type TextNerProParams = Record<string, never>;

export const defaultTextNerProParams: TextNerProParams = {};

interface NerHit {
  text: string;
  type: 'PERSON' | 'ORG' | 'LOCATION' | 'DATE' | 'MONEY' | 'OTHER';
}

export const textNerPro: ToolModule<TextNerProParams> = {
  id: 'text-ner-pro',
  slug: 'text-ner-pro',
  name: 'Named Entity Recognition (PRO)',
  description:
    'Hosted LLM named-entity extraction — pulls people, organisations, places, dates, and money references with much better recall than browser models on long-form text. Uses 1 credit per run.',
  category: 'text',
  keywords: ['ner', 'entities', 'extraction', 'people', 'orgs', 'pro', 'llm'],

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

  chainSuggestions: ['text-summarize-pro', 'text-redact-pro', 'text-keywords'],

  defaults: defaultTextNerProParams,

  async run(
    inputs: File[],
    _params: TextNerProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-ner-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<{ entities: NerHit[] }>(
      'text-ner-pro',
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
