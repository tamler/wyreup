import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import {
  FIND_SIMILAR_LIMITS,
  checkCandidates,
  parseCandidates,
  rankedCsv,
  type RankedRow,
} from '../../lib/candidate-list.js';

export interface TextFindSimilarProParams {
  /** The text to compare every candidate against. */
  target?: string;
  format?: 'csv' | 'json';
}

export const defaultTextFindSimilarProParams: TextFindSimilarProParams = {
  target: '',
  format: 'csv',
};

export const textFindSimilarPro: ToolModule<TextFindSimilarProParams> = {
  id: 'text-find-similar-pro',
  slug: 'text-find-similar-pro',
  name: 'Find Similar Text',
  description:
    'Paste a list, one item per line, and enter the text you are looking for. Every item is scored by meaning with the hosted BGE-M3 multilingual embedding model, so close matches rank high even when they use different words. Returns a ranked CSV or JSON list with scores. Up to 100 items and 50,000 characters per run. Uses 1 credit per run.',
  llmDescription:
    'Rank up to 100 candidate texts (one per line, or a JSON array of strings) by semantic similarity to a target text using hosted @cf/baai/bge-m3 embeddings and cosine similarity. Output is CSV (rank, score, item, text) or JSON. Caps: 4,000 characters per item and per target, 50,000 characters total.',
  category: 'text',
  keywords: ['similar', 'similarity', 'semantic', 'search', 'match', 'embedding', 'bge', 'pro'],

  input: {
    accept: ['text/plain', 'application/json'],
    min: 1,
    max: 1,
    sizeLimit: 256 * 1024,
  },
  output: { mime: 'text/csv' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',

  chainSuggestions: ['csv-sql', 'csv-viewer'],

  defaults: defaultTextFindSimilarProParams,
  paramSchema: {
    target: {
      type: 'string',
      label: 'find text like this',
      placeholder: 'My order arrived damaged and I want a refund',
      help: 'Up to 4,000 characters. Each item in the list is scored against this text.',
      multiline: true,
      maxLength: FIND_SIMILAR_LIMITS.maxQueryChars,
    },
    format: {
      type: 'enum',
      label: 'output format',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
  },

  async run(inputs: File[], params: TextFindSimilarProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-find-similar-pro accepts exactly one input.');
    const candidates = parseCandidates(await inputs[0]!.text());
    const target = (params.target ?? '').trim();
    checkCandidates(candidates, FIND_SIMILAR_LIMITS, target, 'The text to find');

    const result = await runPro<{ model: string; results: RankedRow[] }>(
      'text-find-similar-pro',
      { target, candidates },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    if (params.format === 'json')
      return new Blob([JSON.stringify({ target, ...result }, null, 2)], {
        type: 'application/json',
      });
    return new Blob([rankedCsv(result.results)], { type: 'text/csv' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/csv', 'application/json'] },
};
