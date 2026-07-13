import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type TextRedactProParams = Record<string, never>;

export const defaultTextRedactProParams: TextRedactProParams = {};

export const textRedactPro: ToolModule<TextRedactProParams> = {
  id: 'text-redact-pro',
  slug: 'text-redact-pro',
  name: 'Redact PII',
  description:
    'Hosted LLM strips personal data — names, emails, phones, addresses, SSNs, card-shaped numbers — replacing each with [REDACTED]. Catches free-form mentions ("met Joe at Acme HQ in March") that pattern-based redaction misses. Uses 2 credits per run.',
  category: 'privacy',
  keywords: ['redact', 'pii', 'privacy', 'mask', 'sanitize', 'pro', 'llm'],

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
  creditCost: 2,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-sentences', 'word-counter', 'text-summarize-pro'],

  defaults: defaultTextRedactProParams,

  async run(inputs: File[], _params: TextRedactProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-redact-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<{ redacted: string }>(
      'text-redact-pro',
      { text, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.redacted], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
