import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import {
  RANK_LIMITS,
  checkCandidates,
  parseCandidates,
  rankedCsv,
  type RankedRow,
} from '../../lib/candidate-list.js';

export interface RankResultsProParams {
  /** The question or search the passages should answer. */
  query?: string;
  format?: 'csv' | 'json';
}

export const defaultRankResultsProParams: RankResultsProParams = { query: '', format: 'csv' };

export const rankResultsPro: ToolModule<RankResultsProParams> = {
  id: 'rank-results-pro',
  slug: 'rank-results-pro',
  name: 'Rank Results',
  description:
    'Paste passages or search results, one per line, and enter a question. The hosted BGE reranker reads the question together with each passage and scores how well it answers it, then returns a ranked CSV or JSON list. Best with English or Chinese text. Up to 100 passages of 2,000 characters each. Uses 1 credit per run.',
  llmDescription:
    'Rerank up to 100 passages (one per line, or a JSON array of strings) by relevance to a query using hosted @cf/baai/bge-reranker-base, a cross-encoder trained on English and Chinese. Output is CSV (rank, score, item, text) or JSON. Caps: 500-character query, 2,000 characters per passage, 50,000 characters total.',
  category: 'text',
  keywords: ['rank', 'rerank', 'relevance', 'search', 'passages', 'reranker', 'bge', 'pro'],

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

  defaults: defaultRankResultsProParams,
  paramSchema: {
    query: {
      type: 'string',
      label: 'question or search',
      placeholder: 'How do I reset my password?',
      help: 'Up to 500 characters. Passages that best answer this rank first.',
      maxLength: RANK_LIMITS.maxQueryChars,
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

  async run(inputs: File[], params: RankResultsProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('rank-results-pro accepts exactly one input.');
    const candidates = parseCandidates(await inputs[0]!.text());
    const query = (params.query ?? '').trim();
    checkCandidates(candidates, RANK_LIMITS, query, 'The question');

    const result = await runPro<{ model: string; results: RankedRow[] }>(
      'rank-results-pro',
      { query, candidates },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    if (params.format === 'json')
      return new Blob([JSON.stringify({ query, ...result }, null, 2)], {
        type: 'application/json',
      });
    return new Blob([rankedCsv(result.results)], { type: 'text/csv' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/csv', 'application/json'] },
};
