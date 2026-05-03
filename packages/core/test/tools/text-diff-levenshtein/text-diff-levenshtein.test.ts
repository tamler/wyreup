import { describe, it, expect } from 'vitest';
import { textDiffLevenshtein } from '../../../src/tools/text-diff-levenshtein/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('text-diff-levenshtein — metadata', () => {
  it('has id text-diff-levenshtein', () => {
    expect(textDiffLevenshtein.id).toBe('text-diff-levenshtein');
  });

  it('is in the text category', () => {
    expect(textDiffLevenshtein.category).toBe('text');
  });

  it('requires exactly 2 files', () => {
    expect(textDiffLevenshtein.input.min).toBe(2);
    expect(textDiffLevenshtein.input.max).toBe(2);
  });

  it('outputs application/json', () => {
    expect(textDiffLevenshtein.output.mime).toBe('application/json');
  });

  it('has no installSize', () => {
    expect(textDiffLevenshtein.installSize).toBeUndefined();
  });
});

interface DiffResult {
  distance: number;
  similarity: number;
  maxLength: number;
}

async function parseDiff(blob: Blob | undefined): Promise<DiffResult> {
  return JSON.parse(await blob!.text()) as DiffResult;
}

describe('text-diff-levenshtein — run()', () => {
  it('identical strings have distance 0 and similarity 1', async () => {
    const a = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const b = new File(['hello'], 'b.txt', { type: 'text/plain' });
    const [out] = await textDiffLevenshtein.run([a, b], {}, makeCtx()) as Blob[];
    const data = await parseDiff(out);
    expect(data.distance).toBe(0);
    expect(data.similarity).toBe(1);
  });

  it('completely different strings have low similarity', async () => {
    const a = new File(['aaaa'], 'a.txt', { type: 'text/plain' });
    const b = new File(['bbbb'], 'b.txt', { type: 'text/plain' });
    const [out] = await textDiffLevenshtein.run([a, b], {}, makeCtx()) as Blob[];
    const data = await parseDiff(out);
    expect(data.distance).toBe(4);
    expect(data.similarity).toBe(0);
  });

  it('kitten vs sitting has distance 3', async () => {
    const a = new File(['kitten'], 'a.txt', { type: 'text/plain' });
    const b = new File(['sitting'], 'b.txt', { type: 'text/plain' });
    const [out] = await textDiffLevenshtein.run([a, b], {}, makeCtx()) as Blob[];
    const data = await parseDiff(out);
    expect(data.distance).toBe(3);
  });

  it('similarity is 1 - distance/maxLength', async () => {
    const a = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const b = new File(['helo'], 'b.txt', { type: 'text/plain' });
    const [out] = await textDiffLevenshtein.run([a, b], {}, makeCtx()) as Blob[];
    const data = await parseDiff(out);
    expect(data.maxLength).toBe(5);
    expect(data.distance).toBe(1);
    expect(data.similarity).toBeCloseTo(0.8, 1);
  });

  it('empty strings have similarity 1', async () => {
    const a = new File([''], 'a.txt', { type: 'text/plain' });
    const b = new File([''], 'b.txt', { type: 'text/plain' });
    const [out] = await textDiffLevenshtein.run([a, b], {}, makeCtx()) as Blob[];
    const data = await parseDiff(out);
    expect(data.similarity).toBe(1);
  });

  it('rejects with fewer than 2 files', async () => {
    const a = new File(['hello'], 'a.txt', { type: 'text/plain' });
    await expect(textDiffLevenshtein.run([a], {}, makeCtx())).rejects.toThrow();
  });

  it('includes maxLength in result', async () => {
    const a = new File(['hello world'], 'a.txt', { type: 'text/plain' });
    const b = new File(['hi'], 'b.txt', { type: 'text/plain' });
    const [out] = await textDiffLevenshtein.run([a, b], {}, makeCtx()) as Blob[];
    const data = await parseDiff(out);
    expect(data.maxLength).toBe(11);
  });
});
