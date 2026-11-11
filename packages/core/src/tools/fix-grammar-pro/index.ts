import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type FixGrammarProParams = Record<string, never>;

export const defaultFixGrammarProParams: FixGrammarProParams = {};

/** Mirrors FIX_GRAMMAR.maxChars in functions/_lib/runners.ts. */
export const FIX_GRAMMAR_PRO_MAX_CHARS = 12_000;

export const fixGrammarPro: ToolModule<FixGrammarProParams> = {
  id: 'fix-grammar-pro',
  slug: 'fix-grammar-pro',
  name: 'Fix Grammar',
  description:
    'Hosted Gemma 4 model cleans up grammar, spelling, and punctuation while preserving your voice. Returns the corrected text only, with no commentary. Takes up to 12,000 characters (about 2,000 words) per run. Uses 1 credit per run.',
  category: 'text',
  keywords: ['grammar', 'spelling', 'proofread', 'edit', 'copy-edit', 'pro'],

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
  outputDisplay: 'prose',

  chainSuggestions: ['text-sentences', 'word-counter', 'text-translate-pro'],

  defaults: defaultFixGrammarProParams,

  async run(inputs: File[], _params: FixGrammarProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('fix-grammar-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    if (text.length > FIX_GRAMMAR_PRO_MAX_CHARS) {
      throw new Error(
        `Fix Grammar takes up to ${FIX_GRAMMAR_PRO_MAX_CHARS.toLocaleString('en-US')} characters per run (this text has ${text.length.toLocaleString('en-US')}). Split it into sections.`,
      );
    }

    const result = await runPro<{ corrected: string }>(
      'fix-grammar-pro',
      { text, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.corrected], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
