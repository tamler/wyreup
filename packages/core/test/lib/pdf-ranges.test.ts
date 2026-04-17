import { describe, it, expect } from 'vitest';
import { parseRangeSpec } from '../../src/lib/pdf-ranges.js';

describe('parseRangeSpec', () => {
  it('returns a single page number', () => {
    expect(parseRangeSpec([3], 10)).toEqual([3]);
  });

  it('returns multiple page numbers sorted', () => {
    expect(parseRangeSpec([3, 1, 5], 10)).toEqual([1, 3, 5]);
  });

  it('expands a range string', () => {
    expect(parseRangeSpec(['5-8'], 10)).toEqual([5, 6, 7, 8]);
  });

  it('handles mixed numbers and ranges', () => {
    expect(parseRangeSpec([1, 3, '5-8', 10], 10)).toEqual([1, 3, 5, 6, 7, 8, 10]);
  });

  it('deduplicates overlapping entries', () => {
    expect(parseRangeSpec([1, '1-3', 2], 5)).toEqual([1, 2, 3]);
  });

  it('parses string-form single page numbers', () => {
    expect(parseRangeSpec(['4'], 10)).toEqual([4]);
  });

  it('throws for empty pages array', () => {
    expect(() => parseRangeSpec([], 5)).toThrow('pages must not be empty');
  });

  it('throws for page number out of bounds (too high)', () => {
    expect(() => parseRangeSpec([11], 10)).toThrow('out of range');
  });

  it('throws for page number out of bounds (zero)', () => {
    expect(() => parseRangeSpec([0], 10)).toThrow('out of range');
  });

  it('throws for invalid range (start > end)', () => {
    expect(() => parseRangeSpec(['5-3'], 10)).toThrow('invalid');
  });

  it('throws for range exceeding page count', () => {
    expect(() => parseRangeSpec(['1-15'], 10)).toThrow('invalid');
  });

  it('throws for unrecognized spec format', () => {
    expect(() => parseRangeSpec(['abc'], 10)).toThrow('Invalid page spec');
  });

  it('works with a single-page document', () => {
    expect(parseRangeSpec([1], 1)).toEqual([1]);
  });
});
