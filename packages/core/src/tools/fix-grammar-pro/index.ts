import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import { boundedText, GRAMMAR_MAX_BYTES, ProInputError } from '../../lib/pro-migration-limits.js';

export type FixGrammarProParams = Record<string, never>;

export const defaultFixGrammarProParams: FixGrammarProParams = {};

export const fixGrammarPro: ToolModule<FixGrammarProParams> = {
  id: 'fix-grammar-pro',
  slug: 'fix-grammar-pro',
  name: 'Fix Grammar',
  description:
    'Hosted LLM corrects grammar, spelling and punctuation. Input is limited to 4,000 UTF-8 bytes, including its normalized form. Uses 1 credit per run.',
  category: 'text',
  keywords: ['grammar', 'spelling', 'proofread', 'edit', 'copy-edit', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: GRAMMAR_MAX_BYTES,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-sentences', 'word-counter', 'text-translate-pro'],

  defaults: defaultFixGrammarProParams,

  async run(inputs: File[], _params: FixGrammarProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('fix-grammar-pro accepts exactly one input.');
    const file = inputs[0]!;
    if (file.size > GRAMMAR_MAX_BYTES) {
      throw new ProInputError('input_too_long', `Grammar input exceeds the ${GRAMMAR_MAX_BYTES}-byte limit.`);
    }
    const bytes = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error('Grammar input must be valid UTF-8.');
    }
    if (!text.trim()) throw new Error('Empty input.');
    boundedText(text, GRAMMAR_MAX_BYTES, 'Grammar input');

    const result = await runPro<{ corrected: string }>(
      'fix-grammar-pro',
      { text, fileName: file.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.corrected], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
