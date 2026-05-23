import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TranslateManyProParams {
  source?: string;
  target?: string;
}

export const defaultTranslateManyProParams: TranslateManyProParams = {
  source: 'en',
  target: 'es',
};

export const translateManyPro: ToolModule<TranslateManyProParams> = {
  id: 'translate-many-pro',
  slug: 'translate-many-pro',
  name: 'Translate (100+ languages)',
  description:
    'Hosted M2M-100 — direct translation across 100+ language pairs without going through a chat LLM. Faster and cheaper than the Llama-class Translate for straight-shot translation. Uses 1 credit per run.',
  category: 'text',
  keywords: ['translate', 'translation', 'm2m100', 'language', 'pro', 'hosted'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 256 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-to-speech-pro', 'text-summarize-pro'],

  defaults: defaultTranslateManyProParams,
  paramSchema: {
    source: {
      type: 'string',
      label: 'source language',
      placeholder: 'en',
      help: 'ISO code (en, es, fr, zh, hi, ar, …) or plain name.',
    },
    target: {
      type: 'string',
      label: 'target language',
      placeholder: 'es',
      help: 'ISO code or plain name.',
    },
  },

  async run(
    inputs: File[],
    params: TranslateManyProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('translate-many-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    const source = (params.source ?? 'en').trim() || 'en';
    const target = (params.target ?? 'es').trim() || 'es';

    const result = await runPro<{ translation: string }>(
      'translate-many-pro',
      { text, source, target, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.translation], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
