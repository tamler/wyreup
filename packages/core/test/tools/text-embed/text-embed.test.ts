import { describe, it, expect } from 'vitest';
import { textEmbed, cosineSimilarity } from '../../../src/tools/text-embed/index.js';

describe('text-embed — metadata', () => {
  it('has id text-embed', () => {
    expect(textEmbed.id).toBe('text-embed');
  });

  it('is in the text category', () => {
    expect(textEmbed.category).toBe('text');
  });

  it('accepts text/plain', () => {
    expect(textEmbed.input.accept).toContain('text/plain');
  });

  it('outputs application/json', () => {
    expect(textEmbed.output.mime).toBe('application/json');
  });

  it('has installSize ~23 MB', () => {
    expect(textEmbed.installSize).toBe(23_000_000);
  });

  it('has installGroup nlp-standard', () => {
    expect((textEmbed as unknown as { installGroup: string }).installGroup).toBe('nlp-standard');
  });

  it('requires webgpu preferred', () => {
    expect(textEmbed.requires?.webgpu).toBe('preferred');
  });

  it('accepts at least 1 file', () => {
    expect(textEmbed.input.min).toBe(1);
  });
});

describe('cosineSimilarity helper (text-embed)', () => {
  it('identical vectors have similarity 1', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('orthogonal vectors have similarity 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('opposite vectors have similarity -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('zero vectors return 0', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});
