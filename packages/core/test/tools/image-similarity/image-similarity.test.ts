import { describe, it, expect } from 'vitest';
import {
  imageSimilarity,
  cosineSimilarity,
  clusterByThreshold,
} from '../../../src/tools/image-similarity/index.js';

describe('image-similarity — metadata', () => {
  it('has id image-similarity', () => {
    expect(imageSimilarity.id).toBe('image-similarity');
  });

  it('is in the inspect category', () => {
    expect(imageSimilarity.category).toBe('inspect');
  });

  it('requires at least 2 images', () => {
    expect(imageSimilarity.input.min).toBe(2);
  });

  it('has installSize 87_000_000', () => {
    expect(imageSimilarity.installSize).toBe(87_000_000);
  });

  it('has installGroup image-ai', () => {
    expect((imageSimilarity as unknown as { installGroup: string }).installGroup).toBe('image-ai');
  });

  it('has webgpu preferred requirement', () => {
    expect(imageSimilarity.requires?.webgpu).toBe('preferred');
  });

  it('defaults threshold to 0.85', () => {
    expect(imageSimilarity.defaults.threshold).toBe(0.85);
  });

  it('outputs application/json', () => {
    expect(imageSimilarity.output.mime).toBe('application/json');
  });
});

describe('cosineSimilarity helper', () => {
  it('identical vectors have similarity 1', () => {
    const v = [1, 0, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('orthogonal vectors have similarity 0', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('opposite vectors have similarity -1', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('handles zero vectors without NaN', () => {
    const a = [0, 0];
    const b = [0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns similarity in [-1, 1] range', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.4, 0.3, 0.2, 0.1];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

describe('clusterByThreshold helper', () => {
  it('groups identical-cosine pairs into one cluster', () => {
    const embeddings = [[1, 0], [1, 0], [0, 1]];
    const pairwise = [
      { a: 0, b: 1, cosine: 1.0 },
      { a: 0, b: 2, cosine: 0.0 },
      { a: 1, b: 2, cosine: 0.0 },
    ];
    const clusters = clusterByThreshold(embeddings, pairwise, 0.9);
    // Items 0 and 1 should be in same cluster; item 2 in its own
    const sizes = clusters.map((c) => c.length).sort((a, b) => b - a);
    expect(sizes[0]).toBe(2);
    expect(sizes[1]).toBe(1);
  });

  it('all separate when threshold is 1.0 and none are identical', () => {
    const embeddings = [[1, 0], [0, 1], [0.5, 0.5]];
    const pairwise = [
      { a: 0, b: 1, cosine: 0.0 },
      { a: 0, b: 2, cosine: 0.7 },
      { a: 1, b: 2, cosine: 0.7 },
    ];
    const clusters = clusterByThreshold(embeddings, pairwise, 1.0);
    expect(clusters.length).toBe(3);
  });

  it('all in one cluster when threshold is very low', () => {
    const embeddings = [[1, 0], [0, 1]];
    const pairwise = [{ a: 0, b: 1, cosine: 0.0 }];
    const clusters = clusterByThreshold(embeddings, pairwise, -1.0);
    expect(clusters.length).toBe(1);
  });
});
