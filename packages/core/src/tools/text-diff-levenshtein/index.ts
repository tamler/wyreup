import type { ToolModule, ToolRunContext } from '../../types.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextDiffLevenshteinParams {}

export const defaultTextDiffLevenshteinParams: TextDiffLevenshteinParams = {};

export interface TextDiffLevenshteinResult {
  distance: number;
  similarity: number;
  maxLength: number;
}

export const textDiffLevenshtein: ToolModule<TextDiffLevenshteinParams> = {
  id: 'text-diff-levenshtein',
  slug: 'text-diff-levenshtein',
  name: 'Levenshtein Distance',
  description: 'Compute edit distance and similarity ratio between two text files.',
  category: 'text',
  keywords: ['levenshtein', 'edit distance', 'diff', 'similarity', 'compare', 'fuzzy', 'string'],

  input: {
    accept: ['text/plain'],
    min: 2,
    max: 2,
    sizeLimit: 1 * 1024 * 1024, // 1 MB each — Levenshtein is O(n*m)
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextDiffLevenshteinParams,

  async run(
    inputs: File[],
    _params: TextDiffLevenshteinParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length !== 2) {
      throw new Error('text-diff-levenshtein requires exactly 2 text files.');
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading files' });

    const [a, b] = await Promise.all([inputs[0]!.text(), inputs[1]!.text()]);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Computing edit distance' });

    const { default: leven } = await import('leven');
    const distance = leven(a, b);
    const maxLength = Math.max(a.length, b.length);
    const similarity =
      maxLength === 0 ? 1 : Math.round((1 - distance / maxLength) * 10000) / 10000;

    const result: TextDiffLevenshteinResult = { distance, similarity, maxLength };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt', 'sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
