import type { ToolModule, ToolRunContext } from '../../types.js';

export type TokenModel = 'gpt-4' | 'gpt-3.5-turbo' | 'gpt-4o';

export interface TokenCountParams {
  /** Which model's tokenizer to use. All three use cl100k_base; gpt-4o uses o200k_base. Default gpt-4o. */
  model?: TokenModel;
}

export const defaultTokenCountParams: TokenCountParams = {
  model: 'gpt-4o',
};

export interface TokenCountResult {
  tokens: number;
  model: string;
  characters: number;
  ratio: number;
}

export const tokenCount: ToolModule<TokenCountParams> = {
  id: 'token-count',
  slug: 'token-count',
  name: 'Token Count',
  description: 'Count tokens for GPT-4, GPT-3.5, and GPT-4o — useful for prompt design and cost estimation.',
  category: 'dev',
  keywords: ['tokens', 'gpt', 'openai', 'tokenize', 'prompt', 'cost', 'count', 'llm'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',
  // No installSize — gpt-tokenizer is in-bundle

  defaults: defaultTokenCountParams,

  async run(inputs: File[], params: TokenCountParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('token-count accepts exactly one text file.');
    }
    const input = inputs[0]!;

    const model = params.model ?? 'gpt-4o';

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading text' });

    const text = await input.text();
    const characters = text.length;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Counting tokens' });

    let tokens: number;
    if (model === 'gpt-4o') {
      // gpt-4o uses o200k_base tokenizer
      const { encode } = await import('gpt-tokenizer/model/gpt-4o');
      tokens = encode(text).length;
    } else {
      // gpt-4 and gpt-3.5-turbo use cl100k_base (same tokenizer)
      const { encode } = await import('gpt-tokenizer');
      tokens = encode(text).length;
    }

    const ratio = characters > 0 ? Math.round((tokens / characters) * 10000) / 10000 : 0;

    const result: TokenCountResult = { tokens, model, characters, ratio };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
