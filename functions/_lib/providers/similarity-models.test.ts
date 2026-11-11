import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Env } from '../env';
import {
  CLUSTER_LIMITS,
  EMBED_BATCH,
  FIND_SIMILAR_LIMITS,
  MODEL_BGE_M3,
  MODEL_BGE_RERANKER,
  RANK_LIMITS,
  SIMILARITY_WORST_CASES,
  autoGroups,
  clusterTexts,
  embed,
  findSimilar,
  kmeans,
  prepareCluster,
  prepareFindSimilar,
  prepareRankResults,
  rankResults,
  readCandidates,
  readQuery,
} from './similarity-models';

const RUN_MOCKS = new Map<Env, Mock>();

function envWith(run: (model: string, input: Record<string, unknown>) => unknown): Env {
  const mock = vi.fn((m: string, i: Record<string, unknown>) => Promise.resolve(run(m, i)));
  const env = { AI: { run: mock } } as unknown as Env;
  RUN_MOCKS.set(env, mock);
  return env;
}

/** The AI.run mock behind an env built by envWith. */
function aiRun(env: Env): Mock {
  return RUN_MOCKS.get(env)!;
}

// Fake embedder: each text maps to a fixed direction by its first letter.
const DIRS: Record<string, number[]> = {
  a: [1, 0, 0],
  b: [0, 1, 0],
  c: [0, 0, 1],
};
function fakeVec(text: string): number[] {
  const base = DIRS[text[0].toLowerCase()] ?? [1, 1, 1];
  // Small, deterministic wobble so members are not identical.
  const w = (text.length % 7) / 100;
  return base.map((x, i) => x + (i === 0 ? w : 0));
}
const embedEnv = () =>
  envWith((model, input) => {
    expect(model).toBe(MODEL_BGE_M3);
    return { shape: [0, 3], data: (input.text as string[]).map(fakeVec) };
  });

describe('readCandidates', () => {
  it('accepts a valid list', () => {
    expect(readCandidates({ c: ['x', 'y'] }, 'c', FIND_SIMILAR_LIMITS)).toEqual(['x', 'y']);
  });

  it.each([
    ['not an array', 'x'],
    ['empty list', []],
    ['blank item', ['ok', '   ']],
    ['non-string item', ['ok', 3]],
  ])('rejects %s', (_label, value) => {
    expect(() => readCandidates({ c: value }, 'c', FIND_SIMILAR_LIMITS)).toThrow();
  });

  it('enforces the item count, item length and total caps', () => {
    const many = Array.from({ length: FIND_SIMILAR_LIMITS.maxItems + 1 }, () => 'x');
    expect(() => readCandidates({ c: many }, 'c', FIND_SIMILAR_LIMITS)).toThrow(/more than 100/);
    const long = ['x'.repeat(RANK_LIMITS.maxItemChars + 1)];
    expect(() => readCandidates({ c: long }, 'c', RANK_LIMITS)).toThrow(/longer than 2000/);
    const full = Array.from({ length: 13 }, () => 'x'.repeat(4_000));
    expect(() => readCandidates({ c: full }, 'c', FIND_SIMILAR_LIMITS)).toThrow(/in total/);
    // The query counts toward the total.
    const fits = Array.from({ length: 12 }, () => 'x'.repeat(4_000));
    expect(readCandidates({ c: fits }, 'c', FIND_SIMILAR_LIMITS, 1_000)).toHaveLength(12);
    expect(() => readCandidates({ c: fits }, 'c', FIND_SIMILAR_LIMITS, 2_001)).toThrow(/in total/);
  });

  it('requires at least three texts to group', () => {
    expect(() => readCandidates({ c: ['a', 'b'] }, 'c', CLUSTER_LIMITS)).toThrow(/at least 3/);
  });
});

describe('readQuery', () => {
  it('requires a non-empty string within the cap', () => {
    expect(readQuery({ q: 'hi' }, 'q', 10)).toBe('hi');
    expect(() => readQuery({ q: '  ' }, 'q', 10)).toThrow();
    expect(() => readQuery({ q: 5 }, 'q', 10)).toThrow();
    expect(() => readQuery({ q: 'x'.repeat(11) }, 'q', 10)).toThrow(/longer than 10/);
  });
});

describe('embed', () => {
  it('batches calls and keeps order', async () => {
    const env = embedEnv();
    const texts = Array.from({ length: EMBED_BATCH + 3 }, (_, i) => (i % 2 ? 'b' : 'a') + i);
    const out = await embed(env, texts);
    expect(out).toHaveLength(texts.length);
    expect(aiRun(env)).toHaveBeenCalledTimes(2);
    expect(out[1][1]).toBe(1);
  });

  it('accepts the response field shape', async () => {
    const env = envWith(() => ({ response: [[1, 2]] }));
    expect(await embed(env, ['x'])).toEqual([[1, 2]]);
  });

  it.each([
    ['missing data', {}],
    ['wrong count', { data: [[1], [2]] }],
    ['non-numeric vector', { data: [['x']] }],
    ['empty vector', { data: [[]] }],
  ])('throws on %s', async (_label, res) => {
    await expect(
      embed(
        envWith(() => res),
        ['x'],
      ),
    ).rejects.toThrow();
  });

  it('throws on mixed vector sizes', async () => {
    await expect(
      embed(
        envWith(() => ({ data: [[1, 2], [1]] })),
        ['x', 'y'],
      ),
    ).rejects.toThrow(/different sizes/);
  });
});

describe('findSimilar', () => {
  it('ranks candidates by cosine similarity to the target', async () => {
    const out = await findSimilar(embedEnv(), 'apple', ['banana', 'avocado', 'cherry']);
    expect(out.model).toBe(MODEL_BGE_M3);
    expect(out.results[0]).toMatchObject({ rank: 1, index: 1, text: 'avocado' });
    expect(out.results.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(out.results[0].score).toBeGreaterThan(out.results[1].score);
  });
});

describe('rankResults', () => {
  it('sends query and contexts and sorts by score', async () => {
    const env = envWith((model, input) => {
      expect(model).toBe(MODEL_BGE_RERANKER);
      expect(input).toEqual({
        query: 'q',
        contexts: [{ text: 'x' }, { text: 'y' }, { text: 'z' }],
      });
      return {
        response: [
          { id: 2, score: 0.9 },
          { id: 0, score: 0.1 },
          { id: 1, score: 0.5 },
        ],
      };
    });
    const out = await rankResults(env, 'q', ['x', 'y', 'z']);
    expect(out.results.map((r) => r.text)).toEqual(['z', 'y', 'x']);
    expect(out.results[0]).toEqual({ rank: 1, index: 2, score: 0.9, text: 'z' });
  });

  it.each([
    ['no response', {}],
    ['id out of range', { response: [{ id: 5, score: 1 }] }],
    ['non-numeric score', { response: [{ id: 0, score: 'hi' }] }],
    ['missing candidate', { response: [{ id: 0, score: 1 }] }],
  ])('throws on %s', async (_label, res) => {
    await expect(
      rankResults(
        envWith(() => res),
        'q',
        ['x', 'y'],
      ),
    ).rejects.toThrow();
  });
});

describe('prepare functions validate before any model call', () => {
  it.each([
    ['find similar without target', () => prepareFindSimilar({ candidates: ['a'] }, embedEnv())],
    ['find similar without candidates', () => prepareFindSimilar({ target: 't' }, embedEnv())],
    [
      'find similar over the total cap via the target',
      () =>
        prepareFindSimilar(
          {
            target: 'x'.repeat(4_000),
            candidates: Array.from({ length: 12 }, () => 'y'.repeat(4_000)),
          },
          embedEnv(),
        ),
    ],
    [
      'rank with a long query',
      () => prepareRankResults({ query: 'q'.repeat(501), candidates: ['a'] }, embedEnv()),
    ],
    ['cluster with 2 texts', () => prepareCluster({ texts: ['a', 'b'] }, embedEnv())],
    [
      'cluster with groups 1',
      () => prepareCluster({ texts: ['a', 'b', 'c'], groups: 1 }, embedEnv()),
    ],
    [
      'cluster with groups 11',
      () => prepareCluster({ texts: ['a', 'b', 'c'], groups: 11 }, embedEnv()),
    ],
    [
      'cluster with fractional groups',
      () => prepareCluster({ texts: ['a', 'b', 'c'], groups: 2.5 }, embedEnv()),
    ],
    [
      'cluster with string groups',
      () => prepareCluster({ texts: ['a', 'b', 'c'], groups: '3' }, embedEnv()),
    ],
    [
      'cluster with more groups than texts',
      () => prepareCluster({ texts: ['a', 'b', 'c'], groups: 4 }, embedEnv()),
    ],
  ])('rejects %s', (_label, prepare) => {
    expect(prepare).toThrow();
  });

  it('dispatches valid input', async () => {
    const env = embedEnv();
    const run = prepareCluster({ texts: ['apple', 'banana', 'avocado'] }, env);
    expect(aiRun(env)).not.toHaveBeenCalled();
    const out = await run();
    expect(out.groupCount).toBe(2);
    expect(aiRun(env)).toHaveBeenCalledTimes(1);
  });
});

describe('kmeans and clusterTexts', () => {
  it('chooses a bounded default group count', () => {
    expect(autoGroups(3)).toBe(2);
    expect(autoGroups(50)).toBe(5);
    expect(autoGroups(100)).toBe(7);
    expect(autoGroups(10_000)).toBe(10);
  });

  it('is deterministic and separates clear directions', () => {
    const vecs = [
      [1, 0],
      [0, 1],
      [0.9, 0.1],
      [0.1, 0.9],
    ];
    const a = kmeans(vecs, 2).assign;
    expect(kmeans(vecs, 2).assign).toEqual(a);
    expect(a[0]).toBe(a[2]);
    expect(a[1]).toBe(a[3]);
    expect(a[0]).not.toBe(a[1]);
  });

  it('groups texts, numbers the largest group 1 and keeps input order in rows', async () => {
    const texts = ['apple', 'banana', 'apricot', 'blueberry', 'avocado', 'cherry'];
    const out = await clusterTexts(embedEnv(), texts, 3);
    expect(out.groupCount).toBe(3);
    expect(out.rows.map((r) => r.text)).toEqual(texts);
    expect(out.groups[0].size).toBe(3);
    expect(out.groups[0].members.map((m) => m.text).sort()).toEqual([
      'apple',
      'apricot',
      'avocado',
    ]);
    const g = new Map(out.rows.map((r) => [r.text, r.group]));
    expect(g.get('apple')).toBe(1);
    expect(g.get('banana')).toBe(g.get('blueberry'));
    expect(out.groups.reduce((s, x) => s + x.size, 0)).toBe(texts.length);
  });
});

describe('worst-case cost rows', () => {
  it('price the largest input each runner accepts', () => {
    const usd = Object.fromEntries(SIMILARITY_WORST_CASES.map((c) => [c.toolId, c.usd]));
    // 50,000 chars + 101 texts x 4 specials = 50,404 tokens at $0.012/M.
    expect(usd['text-find-similar-pro']).toBeCloseTo((50_404 * 0.012) / 1e6, 12);
    // 100 pairs x (500 + 4) + 49,500 passage chars = 99,900 tokens at $0.00311/M.
    expect(usd['rank-results-pro']).toBeCloseTo((99_900 * 0.00311) / 1e6, 12);
    // 50,000 chars + 100 texts x 4 specials = 50,400 tokens at $0.012/M.
    expect(usd['text-cluster-pro']).toBeCloseTo((50_400 * 0.012) / 1e6, 12);
  });

  it('keep every bge-m3 request inside its 60,000-token window at 1 token per char', () => {
    // A request holds at most the whole run, plus specials per text.
    for (const l of [FIND_SIMILAR_LIMITS, CLUSTER_LIMITS])
      expect(l.maxTotalChars + EMBED_BATCH * 4).toBeLessThanOrEqual(60_000);
    // Each text stays inside bge-m3's 8,192-token per-text limit.
    expect(FIND_SIMILAR_LIMITS.maxItemChars).toBeLessThanOrEqual(8_190);
    expect(FIND_SIMILAR_LIMITS.maxQueryChars).toBeLessThanOrEqual(8_190);
  });
});
