import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  CLUSTER_LIMITS,
  FIND_SIMILAR_LIMITS,
  RANK_LIMITS,
  csvCell,
  parseCandidates,
} from '../../../src/lib/candidate-list.js';
import { textFindSimilarPro } from '../../../src/tools/text-find-similar-pro/index.js';
import { rankResultsPro } from '../../../src/tools/rank-results-pro/index.js';
import { textClusterPro } from '../../../src/tools/text-cluster-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const SERVER_LIMITS = fileURLToPath(
  new URL('../../../../../functions/_lib/providers/similarity-models.js', import.meta.url),
);

const IDS = ['text-find-similar-pro', 'rank-results-pro', 'text-cluster-pro'] as const;

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'similarity-pro-test',
    apiKey: 'test-key',
  };
}

function file(text: string): File {
  return new File([text], 'list.txt', { type: 'text/plain' });
}

function mockPro(result: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentInput(fetchMock: ReturnType<typeof mockPro>): Record<string, unknown> {
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return (JSON.parse(init.body as string) as { input: Record<string, unknown> }).input;
}

afterEach(() => vi.unstubAllGlobals());

describe('similarity Pro tools', () => {
  it('are registered as 1-credit text tools that output CSV', () => {
    const registry = createDefaultRegistry();
    for (const id of IDS) {
      const tool = registry.toolsById.get(id);
      expect(tool, id).toBeDefined();
      expect(tool?.cost).toBe('credit');
      expect(tool?.creditCost).toBe(1);
      expect(tool?.output.mime).toBe('text/csv');
      expect(tool?.description).toContain('Uses 1 credit per run.');
      expect(tool?.description, id).not.toMatch(/[—–]/);
      expect(tool?.llmDescription, id).not.toMatch(/[—–]/);
    }
  });

  it('mirror the server caps exactly', async () => {
    const server = (await import(SERVER_LIMITS)) as Record<string, unknown>;
    expect(FIND_SIMILAR_LIMITS).toEqual(server.FIND_SIMILAR_LIMITS);
    expect(RANK_LIMITS).toEqual(server.RANK_LIMITS);
    expect(CLUSTER_LIMITS).toEqual(server.CLUSTER_LIMITS);
  });

  it('state the caps they enforce', () => {
    expect(textFindSimilarPro.description).toContain('Up to 100 items and 50,000 characters');
    expect(rankResultsPro.description).toContain('Up to 100 passages of 2,000 characters');
    expect(textClusterPro.description).toContain('Up to 100 items and 50,000 characters');
  });
});

describe('parseCandidates and csvCell', () => {
  it('reads one item per line, skipping blanks', () => {
    expect(parseCandidates(' a \n\n b\r\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('reads a JSON array of strings', () => {
    expect(parseCandidates('["x", " y ", ""]')).toEqual(['x', 'y']);
    expect(() => parseCandidates('["x", 2]')).toThrow(/only strings/);
  });

  it('treats a line that only looks like JSON as text', () => {
    expect(parseCandidates('[draft] one\ntwo')).toEqual(['[draft] one', 'two']);
  });

  it('quotes and defuses spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(0.5)).toBe('0.5');
  });
});

describe('client-side refusals before any hosted call', () => {
  it('find similar needs a target', async () => {
    const fetchMock = mockPro({});
    await expect(
      textFindSimilarPro.run([file('a\nb')], { target: ' ', format: 'csv' }, makeCtx()),
    ).rejects.toThrow('The text to find is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rank refuses more than 100 passages and long queries', async () => {
    const fetchMock = mockPro({});
    const many = Array.from({ length: 101 }, (_, i) => `p${i}`).join('\n');
    await expect(rankResultsPro.run([file(many)], { query: 'q' }, makeCtx())).rejects.toThrow(
      /Up to 100 items/,
    );
    await expect(
      rankResultsPro.run([file('a')], { query: 'q'.repeat(501) }, makeCtx()),
    ).rejects.toThrow(/longer than 500/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('grouping refuses more groups than items and fewer than 3 items', async () => {
    const fetchMock = mockPro({});
    await expect(textClusterPro.run([file('a\nb\nc')], { groups: 5 }, makeCtx())).rejects.toThrow(
      /only 3 items/,
    );
    await expect(textClusterPro.run([file('a\nb')], {}, makeCtx())).rejects.toThrow(/at least 3/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('outputs', () => {
  const ranked = {
    model: '@cf/baai/bge-m3',
    results: [
      { rank: 1, index: 1, score: 0.9, text: 'refund please' },
      { rank: 2, index: 0, score: 0.2, text: '=cmd' },
    ],
  };

  it('find similar sends the parsed list and returns CSV', async () => {
    const fetchMock = mockPro(ranked);
    const blob = (await textFindSimilarPro.run(
      [file('=cmd\nrefund please\n')],
      { target: 'money back', format: 'csv' },
      makeCtx(),
    )) as Blob;
    expect(sentInput(fetchMock)).toEqual({
      target: 'money back',
      candidates: ['=cmd', 'refund please'],
    });
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toBe(
      "rank,score,item,text\r\n1,0.9,2,refund please\r\n2,0.2,1,'=cmd\r\n",
    );
  });

  it('rank returns JSON with the query when asked', async () => {
    mockPro({ ...ranked, model: '@cf/baai/bge-reranker-base' });
    const blob = (await rankResultsPro.run(
      [file('a\nb')],
      { query: 'q', format: 'json' },
      makeCtx(),
    )) as Blob;
    expect(blob.type).toBe('application/json');
    const body = JSON.parse(await blob.text()) as { query: string; results: unknown[] };
    expect(body.query).toBe('q');
    expect(body.results).toHaveLength(2);
  });

  it('grouping sends a chosen group count and writes CSV sorted by group', async () => {
    const fetchMock = mockPro({
      model: '@cf/baai/bge-m3',
      groupCount: 2,
      rows: [
        { index: 0, group: 2, text: 'late delivery' },
        { index: 1, group: 1, text: 'great price' },
        { index: 2, group: 1, text: 'cheap' },
      ],
      groups: [],
    });
    const blob = (await textClusterPro.run(
      [file('late delivery\ngreat price\ncheap')],
      { groups: 2 },
      makeCtx(),
    )) as Blob;
    expect(sentInput(fetchMock)).toEqual({
      texts: ['late delivery', 'great price', 'cheap'],
      groups: 2,
    });
    expect(await blob.text()).toBe(
      'group,item,text\r\n1,2,great price\r\n1,3,cheap\r\n2,1,late delivery\r\n',
    );
  });

  it('grouping leaves the count to the server on auto', async () => {
    const fetchMock = mockPro({ model: 'm', groupCount: 2, rows: [], groups: [] });
    await textClusterPro.run([file('a\nb\nc')], { groups: 'auto' }, makeCtx());
    expect(sentInput(fetchMock)).toEqual({ texts: ['a', 'b', 'c'] });
  });
});
