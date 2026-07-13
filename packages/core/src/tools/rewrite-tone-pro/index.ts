import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface RewriteToneProParams {
  tone?: 'formal' | 'casual' | 'kid-friendly' | 'concise' | 'professional' | 'friendly';
}

export const defaultRewriteToneProParams: RewriteToneProParams = { tone: 'professional' };

export const rewriteTonePro: ToolModule<RewriteToneProParams> = {
  id: 'rewrite-tone-pro',
  slug: 'rewrite-tone-pro',
  name: 'Rewrite Tone',
  description:
    'Hosted fast LLM rewrites your text in a chosen tone — formal, casual, kid-friendly, concise, professional, or friendly. Useful for email drafts, customer replies, and turning a rough note into something you can send. Uses 1 credit per run.',
  category: 'text',
  keywords: ['rewrite', 'tone', 'paraphrase', 'voice', 'style', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 128 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-sentences', 'word-counter', 'text-to-speech-pro'],

  defaults: defaultRewriteToneProParams,
  paramSchema: {
    tone: {
      type: 'enum',
      label: 'tone',
      help: 'Voice to rewrite in.',
      options: [
        { value: 'professional', label: 'professional' },
        { value: 'formal', label: 'formal' },
        { value: 'casual', label: 'casual' },
        { value: 'friendly', label: 'friendly' },
        { value: 'concise', label: 'concise' },
        { value: 'kid-friendly', label: 'kid-friendly' },
      ],
    },
  },

  async run(inputs: File[], params: RewriteToneProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('rewrite-tone-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');

    const result = await runPro<{ rewritten: string }>(
      'rewrite-tone-pro',
      {
        text,
        tone: params.tone ?? 'professional',
        fileName: inputs[0]!.name,
      },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.rewritten], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
