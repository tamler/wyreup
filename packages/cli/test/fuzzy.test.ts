import { describe, it, expect } from 'vitest';
import { levenshtein, suggestSimilar, formatSuggestion } from '../src/lib/fuzzy.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns the length when one string is empty', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
  });

  it('counts single substitutions', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('counts single insertions and deletions', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('handles the canonical kitten/sitting example (distance 3)', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('suggestSimilar', () => {
  const REGISTRY = ['compress', 'convert', 'merge-pdf', 'split-pdf', 'kml-to-geojson', 'csv-to-geojson'];

  it('returns the closest matches sorted by distance', () => {
    expect(suggestSimilar('comprese', REGISTRY)).toContain('compress');
  });

  it('returns nothing when nothing is within maxDistance', () => {
    expect(suggestSimilar('zxcvbnm', REGISTRY, { maxDistance: 2 })).toEqual([]);
  });

  it('respects the limit', () => {
    const result = suggestSimilar('pdf', REGISTRY, { limit: 1 });
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('is case-insensitive', () => {
    expect(suggestSimilar('COMPRESS', REGISTRY)).toContain('compress');
  });

  it('finds geo tool typos like csv-geojson → csv-to-geojson', () => {
    const result = suggestSimilar('csv-geojson', REGISTRY);
    expect(result).toContain('csv-to-geojson');
  });
});

describe('formatSuggestion', () => {
  const REGISTRY = ['compress', 'convert', 'merge-pdf', 'split-pdf'];

  it('produces a multi-line message with candidates', () => {
    const msg = formatSuggestion('comprese', REGISTRY);
    expect(msg).toContain('Unknown tool: "comprese"');
    expect(msg).toContain('Did you mean');
    expect(msg).toContain('compress');
    expect(msg).toContain('wyreup list');
  });

  it('falls back gracefully when nothing matches', () => {
    const msg = formatSuggestion('xyzzy123', REGISTRY);
    expect(msg).toContain('Unknown tool: "xyzzy123"');
    expect(msg).not.toContain('Did you mean');
    expect(msg).toContain('wyreup list');
  });

  it('always ends with a newline', () => {
    expect(formatSuggestion('x', REGISTRY).endsWith('\n')).toBe(true);
    expect(formatSuggestion('xyzzy123', REGISTRY).endsWith('\n')).toBe(true);
  });
});
