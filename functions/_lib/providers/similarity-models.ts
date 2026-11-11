// Embedding and reranking provider for the similarity Pro tools.
//
//   text-find-similar-pro  @cf/baai/bge-m3 embeddings, cosine ranking
//   rank-results-pro       @cf/baai/bge-reranker-base relevance scores
//   text-cluster-pro       @cf/baai/bge-m3 embeddings, k-means grouping
//
// Each run makes exactly one pass over its input: no retries, no fallback
// model. The caps below are the cost bound: cost-model.ts prices the largest
// input they allow, counting 1 token per character (the safe bound for
// non-English text; English is closer to 4 characters per token) plus the
// special tokens each model adds per text.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export const MODEL_BGE_M3 = '@cf/baai/bge-m3';
export const MODEL_BGE_RERANKER = '@cf/baai/bge-reranker-base';

export interface ListLimits {
  minItems: number;
  maxItems: number;
  /** Per-candidate character cap. */
  maxItemChars: number;
  /** Cap on the target or query; 0 when the tool takes none. */
  maxQueryChars: number;
  /** Cap on every character sent: candidates plus target or query. */
  maxTotalChars: number;
}

// bge-m3 reads up to 8,192 tokens per text and 60,000 per request. 4,000
// characters stays under the per-text limit even at 1 token per character,
// and 50,000 total characters stays under the request limit.
export const FIND_SIMILAR_LIMITS: ListLimits = {
  minItems: 1,
  maxItems: 100,
  maxItemChars: 4_000,
  maxQueryChars: 4_000,
  maxTotalChars: 50_000,
};

// bge-reranker-base scores each (query, passage) pair inside a 512-token
// window, so passages are kept short and the query shorter.
export const RANK_LIMITS: ListLimits = {
  minItems: 1,
  maxItems: 100,
  maxItemChars: 2_000,
  maxQueryChars: 500,
  maxTotalChars: 50_000,
};

export const CLUSTER_LIMITS: ListLimits = {
  minItems: 3,
  maxItems: 100,
  maxItemChars: 4_000,
  maxQueryChars: 0,
  maxTotalChars: 50_000,
};

export const CLUSTER_MIN_GROUPS = 2;
export const CLUSTER_MAX_GROUPS = 10;
const KMEANS_MAX_ITERATIONS = 50;

/** Texts per bge-m3 call. Cost is per token, so batching does not change it. */
export const EMBED_BATCH = 50;

// ── Worst-case cost (consumed by cost-model.ts) ───────────────────────────

/**
 * USD per million input tokens; neither model bills output. Takes the
 * higher of the charter figure and the model page: bge-m3 $0.012 (page
 * says $0.0118), bge-reranker-base $0.00311 (charter says $0.003).
 */
export const SIMILARITY_USD_PER_M: Readonly<Record<string, number>> = {
  [MODEL_BGE_M3]: 0.012,
  [MODEL_BGE_RERANKER]: 0.00311,
};
/** Upper bound for any text: one token per UTF-16 code unit. */
export const TOKENS_PER_CHAR = 1;
/** Special tokens per text or per pair: <s> q </s></s> p </s> is 4. */
export const SPECIAL_TOKENS_PER_TEXT = 4;

/** Embedding run: every character once, plus specials for each text. */
function embedWorstTokens(l: ListLimits): number {
  const texts = l.maxItems + (l.maxQueryChars > 0 ? 1 : 0);
  return l.maxTotalChars * TOKENS_PER_CHAR + texts * SPECIAL_TOKENS_PER_TEXT;
}

/**
 * Rerank run: the query is read once per pair. With q query chars the
 * passages hold at most maxTotalChars - q, so tokens are
 * n(q + specials) + (maxTotalChars - q), largest at the longest query.
 * Ignores the 512-token pair window, which can only lower the count.
 */
function rerankWorstTokens(l: ListLimits): number {
  const q = l.maxQueryChars * TOKENS_PER_CHAR;
  return l.maxItems * (q + SPECIAL_TOKENS_PER_TEXT) + (l.maxTotalChars * TOKENS_PER_CHAR - q);
}

export interface SimilarityWorstCase {
  toolId: string;
  detail: string;
  usd: number;
}

function row(toolId: string, model: string, tokens: number): SimilarityWorstCase {
  return {
    toolId,
    detail: `${model}: ${tokens} input tokens, one call pass, no retry or fallback`,
    usd: (tokens * SIMILARITY_USD_PER_M[model]) / 1e6,
  };
}

export const SIMILARITY_WORST_CASES: readonly SimilarityWorstCase[] = [
  row('text-find-similar-pro', MODEL_BGE_M3, embedWorstTokens(FIND_SIMILAR_LIMITS)),
  row('rank-results-pro', MODEL_BGE_RERANKER, rerankWorstTokens(RANK_LIMITS)),
  row('text-cluster-pro', MODEL_BGE_M3, embedWorstTokens(CLUSTER_LIMITS)),
];

export interface RankedItem {
  rank: number;
  /** Zero-based position in the candidate list the caller sent. */
  index: number;
  score: number;
  text: string;
}

export interface RankedResult {
  model: string;
  results: RankedItem[];
}

export interface ClusterResult {
  model: string;
  groupCount: number;
  /** One row per input text, in input order. */
  rows: { index: number; group: number; text: string }[];
  /** Groups largest first; `example` is the member closest to the group centre. */
  groups: {
    group: number;
    size: number;
    example: string;
    members: { index: number; similarity: number; text: string }[];
  }[];
}

/** Validate an untrusted list of candidate strings against `limits`. */
export function readCandidates(
  raw: Record<string, unknown>,
  field: string,
  limits: ListLimits,
  queryChars = 0,
): string[] {
  const v = raw[field];
  if (!Array.isArray(v)) throw new Error(`'${field}' must be an array of strings`);
  if (v.length < limits.minItems)
    throw new Error(
      `'${field}' needs at least ${limits.minItems} item${limits.minItems === 1 ? '' : 's'}`,
    );
  if (v.length > limits.maxItems)
    throw new Error(`'${field}' has more than ${limits.maxItems} items`);
  let total = queryChars;
  const out: string[] = [];
  for (const [i, item] of v.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0)
      throw new Error(`'${field}' item ${i + 1} must be a non-empty string`);
    if (item.length > limits.maxItemChars)
      throw new Error(`'${field}' item ${i + 1} is longer than ${limits.maxItemChars} characters`);
    total += item.length;
    out.push(item);
  }
  if (total > limits.maxTotalChars)
    throw new Error(`Input is longer than ${limits.maxTotalChars} characters in total`);
  return out;
}

/** Validate an untrusted target or query string. */
export function readQuery(raw: Record<string, unknown>, field: string, maxChars: number): string {
  const v = raw[field];
  if (typeof v !== 'string' || v.trim().length === 0)
    throw new Error(`'${field}' (non-empty string) is required`);
  if (v.length > maxChars) throw new Error(`'${field}' is longer than ${maxChars} characters`);
  return v;
}

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = (await withTimeout(
      env.AI.run(MODEL_BGE_M3, { text: batch }),
      INFERENCE_TIMEOUTS.text,
      'embed-bge-m3',
    )) as { data?: unknown; response?: unknown } | null;
    const data = res?.data ?? res?.response;
    if (!Array.isArray(data) || data.length !== batch.length)
      throw new Error('Embedding model returned the wrong number of vectors');
    for (const vec of data) {
      if (
        !Array.isArray(vec) ||
        vec.length === 0 ||
        !vec.every((x) => typeof x === 'number' && Number.isFinite(x))
      )
        throw new Error('Embedding model returned an invalid vector');
      vectors.push(vec as number[]);
    }
  }
  const dim = vectors[0].length;
  if (!vectors.every((v) => v.length === dim))
    throw new Error('Embedding model returned vectors of different sizes');
  return vectors;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function ranked(candidates: string[], scores: number[]): RankedItem[] {
  return candidates
    .map((text, index) => ({ index, score: scores[index], text }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r, i) => ({ rank: i + 1, index: r.index, score: round4(r.score), text: r.text }));
}

export async function findSimilar(
  env: Env,
  target: string,
  candidates: string[],
): Promise<RankedResult> {
  const [t, ...vecs] = await embed(env, [target, ...candidates]);
  return {
    model: MODEL_BGE_M3,
    results: ranked(
      candidates,
      vecs.map((v) => cosine(t, v)),
    ),
  };
}

export async function rankResults(
  env: Env,
  query: string,
  candidates: string[],
): Promise<RankedResult> {
  const res = (await withTimeout(
    env.AI.run(MODEL_BGE_RERANKER, {
      query,
      contexts: candidates.map((text) => ({ text })),
    }),
    INFERENCE_TIMEOUTS.text,
    'rerank-bge-reranker-base',
  )) as { response?: unknown } | null;
  const rows = res?.response;
  if (!Array.isArray(rows)) throw new Error('Ranking model returned no scores');
  const scores = Array.from<number | undefined>({ length: candidates.length });
  for (const row of rows) {
    const r = row as { id?: unknown; score?: unknown };
    if (
      typeof r.id !== 'number' ||
      !Number.isInteger(r.id) ||
      r.id < 0 ||
      r.id >= candidates.length ||
      typeof r.score !== 'number' ||
      !Number.isFinite(r.score)
    )
      throw new Error('Ranking model returned an unexpected score');
    scores[r.id] = r.score;
  }
  if (scores.some((s) => s === undefined))
    throw new Error('Ranking model did not score every candidate');
  return { model: MODEL_BGE_RERANKER, results: ranked(candidates, scores as number[]) };
}

/** Default group count when the caller does not choose one. */
export function autoGroups(n: number): number {
  return Math.min(
    CLUSTER_MAX_GROUPS,
    Math.max(CLUSTER_MIN_GROUPS, Math.round(Math.sqrt(n / 2))),
    n,
  );
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v.slice() : v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Deterministic spherical k-means: farthest-point seeding from the first
 * text, then Lloyd iterations on unit vectors. Same input, same groups.
 * Returns the group (0-based) of each vector.
 */
export function kmeans(
  vectors: number[][],
  k: number,
): { assign: number[]; centroids: number[][] } {
  const units = vectors.map(normalize);
  const centroids: number[][] = [units[0].slice()];
  const best = units.map((u) => dot(u, centroids[0]));
  while (centroids.length < k) {
    let far = 0;
    for (let i = 1; i < units.length; i++) if (best[i] < best[far]) far = i;
    centroids.push(units[far].slice());
    for (let i = 0; i < units.length; i++) best[i] = Math.max(best[i], dot(units[i], units[far]));
  }
  let assign = new Array<number>(units.length).fill(-1);
  for (let iter = 0; iter < KMEANS_MAX_ITERATIONS; iter++) {
    const next = units.map((u) => {
      let g = 0;
      let s = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dot(u, centroids[c]);
        if (d > s) {
          s = d;
          g = c;
        }
      }
      return g;
    });
    const changed = next.some((g, i) => g !== assign[i]);
    assign = next;
    if (!changed) break;
    for (let c = 0; c < centroids.length; c++) {
      const members = units.filter((_, i) => assign[i] === c);
      if (members.length === 0) continue; // keep the old centre
      const sum = new Array<number>(members[0].length).fill(0);
      for (const m of members) for (let j = 0; j < m.length; j++) sum[j] += m[j];
      centroids[c] = normalize(sum);
    }
  }
  return { assign, centroids };
}

// Runner entry points: validate the untrusted input synchronously, then
// return the dispatch closure (same contract as runners.ts PreparedProRun).

export function prepareFindSimilar(
  raw: Record<string, unknown>,
  env: Env,
): () => Promise<RankedResult> {
  const target = readQuery(raw, 'target', FIND_SIMILAR_LIMITS.maxQueryChars);
  const candidates = readCandidates(raw, 'candidates', FIND_SIMILAR_LIMITS, target.length);
  return () => findSimilar(env, target, candidates);
}

export function prepareRankResults(
  raw: Record<string, unknown>,
  env: Env,
): () => Promise<RankedResult> {
  const query = readQuery(raw, 'query', RANK_LIMITS.maxQueryChars);
  const candidates = readCandidates(raw, 'candidates', RANK_LIMITS, query.length);
  return () => rankResults(env, query, candidates);
}

export function prepareCluster(
  raw: Record<string, unknown>,
  env: Env,
): () => Promise<ClusterResult> {
  const texts = readCandidates(raw, 'texts', CLUSTER_LIMITS);
  const g = raw.groups;
  if (
    g !== undefined &&
    (typeof g !== 'number' ||
      !Number.isInteger(g) ||
      g < CLUSTER_MIN_GROUPS ||
      g > CLUSTER_MAX_GROUPS)
  )
    throw new Error(
      `'groups' must be an integer from ${CLUSTER_MIN_GROUPS} to ${CLUSTER_MAX_GROUPS}`,
    );
  if (typeof g === 'number' && g > texts.length)
    throw new Error(`'groups' cannot exceed the number of texts`);
  const groups = typeof g === 'number' ? g : autoGroups(texts.length);
  return () => clusterTexts(env, texts, groups);
}

export async function clusterTexts(
  env: Env,
  texts: string[],
  groups: number,
): Promise<ClusterResult> {
  const vectors = await embed(env, texts);
  const { assign, centroids } = kmeans(vectors, groups);
  const units = vectors.map(normalize);
  const built = centroids
    .map((c, g) => {
      const members = texts
        .map((text, index) => ({ index, text, similarity: round4(dot(units[index], c)) }))
        .filter((m) => assign[m.index] === g)
        .sort((a, b) => b.similarity - a.similarity || a.index - b.index);
      return { members, first: members[0]?.index ?? Infinity };
    })
    .filter((g) => g.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || a.first - b.first);
  // Renumber so group 1 is the largest.
  const label = new Map<number, number>();
  built.forEach((g, i) => g.members.forEach((m) => label.set(m.index, i + 1)));
  return {
    model: MODEL_BGE_M3,
    groupCount: built.length,
    rows: texts.map((text, index) => ({ index, group: label.get(index)!, text })),
    groups: built.map((g, i) => ({
      group: i + 1,
      size: g.members.length,
      example: g.members[0].text,
      members: g.members,
    })),
  };
}
