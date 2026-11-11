import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import {
  CLUSTER_LIMITS,
  checkCandidates,
  parseCandidates,
  toCsv,
} from '../../lib/candidate-list.js';

export type ClusterGroups = 'auto' | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface TextClusterProParams {
  groups?: ClusterGroups;
  format?: 'csv' | 'json';
}

export const defaultTextClusterProParams: TextClusterProParams = { groups: 'auto', format: 'csv' };

interface ClusterResult {
  model: string;
  groupCount: number;
  rows: { index: number; group: number; text: string }[];
  groups: {
    group: number;
    size: number;
    example: string;
    members: { index: number; similarity: number; text: string }[];
  }[];
}

export const textClusterPro: ToolModule<TextClusterProParams> = {
  id: 'text-cluster-pro',
  slug: 'text-cluster-pro',
  name: 'Group Similar Text',
  description:
    'Paste a list, one item per line, such as survey answers or support messages, and get them sorted into groups of similar meaning. Uses the hosted BGE-M3 multilingual embedding model, then groups the results with k-means. Groups are numbered, not named; the most typical item in each group is shown as its example. Up to 100 items and 50,000 characters per run. Uses 1 credit per run.',
  llmDescription:
    'Group 3 to 100 texts (one per line, or a JSON array of strings) by meaning: hosted @cf/baai/bge-m3 embeddings, then deterministic k-means with 2 to 10 groups (auto picks about the square root of half the item count). Groups are numbered by size and are not named. CSV has one row per item (group, item, text); JSON adds each group with its most central example. Caps: 4,000 characters per item, 50,000 total.',
  category: 'text',
  keywords: ['cluster', 'group', 'categorize', 'themes', 'feedback', 'embedding', 'k-means', 'pro'],

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

  defaults: defaultTextClusterProParams,
  paramSchema: {
    groups: {
      type: 'enum',
      label: 'number of groups',
      help: 'Auto picks a count from the list size. Each group always has at least one item.',
      options: [
        { value: 'auto', label: 'auto' },
        ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) })),
      ],
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

  async run(inputs: File[], params: TextClusterProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-cluster-pro accepts exactly one input.');
    const texts = parseCandidates(await inputs[0]!.text());
    checkCandidates(texts, CLUSTER_LIMITS);
    const raw = params.groups ?? 'auto';
    const groups = raw === 'auto' ? undefined : Number(raw);
    if (groups !== undefined && groups > texts.length)
      throw new Error(`Asked for ${groups} groups but the list has only ${texts.length} items.`);

    const result = await runPro<ClusterResult>(
      'text-cluster-pro',
      groups === undefined ? { texts } : { texts, groups },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    if (params.format === 'json')
      return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const rows = [...result.rows].sort((a, b) => a.group - b.group || a.index - b.index);
    return new Blob(
      [
        toCsv(
          ['group', 'item', 'text'],
          rows.map((r) => [r.group, r.index + 1, r.text]),
        ),
      ],
      { type: 'text/csv' },
    );
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/csv', 'application/json'] },
};
