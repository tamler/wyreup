import { describe, it, expect } from 'vitest';
import { textStats, computeTextStats, countSyllables } from '../../../src/tools/text-stats/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('text-stats — metadata', () => {
  it('has id text-stats', () => {
    expect(textStats.id).toBe('text-stats');
  });

  it('is in the text category', () => {
    expect(textStats.category).toBe('text');
  });

  it('accepts text/plain', () => {
    expect(textStats.input.accept).toContain('text/plain');
  });

  it('outputs application/json', () => {
    expect(textStats.output.mime).toBe('application/json');
  });

  it('has no installSize', () => {
    expect(textStats.installSize).toBeUndefined();
  });
});

describe('countSyllables', () => {
  it('counts syllables in simple words', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('hello')).toBe(2);
    expect(countSyllables('beautiful')).toBe(3);
  });

  it('returns at least 1 for any non-empty word', () => {
    expect(countSyllables('rhythm')).toBeGreaterThanOrEqual(1);
  });

  it('handles empty string', () => {
    expect(countSyllables('')).toBe(0);
  });

  it('handles words with only consonants', () => {
    expect(countSyllables('nth')).toBeGreaterThanOrEqual(1);
  });
});

describe('computeTextStats', () => {
  it('counts characters correctly', () => {
    const result = computeTextStats('Hello World');
    expect(result.chars).toBe(11);
    expect(result.charsNoSpaces).toBe(10);
  });

  it('counts words correctly', () => {
    const result = computeTextStats('The quick brown fox');
    expect(result.words).toBe(4);
  });

  it('counts sentences', () => {
    const result = computeTextStats('Hello! How are you? I am fine.');
    expect(result.sentences).toBe(3);
  });

  it('counts paragraphs', () => {
    const result = computeTextStats('Paragraph one.\n\nParagraph two.');
    expect(result.paragraphs).toBe(2);
  });

  it('computes reading time (words / 238)', () => {
    const result = computeTextStats('word '.repeat(238).trim());
    expect(result.readingTimeMinutes).toBeCloseTo(1.0, 1);
  });

  it('computes speaking time (words / 150)', () => {
    const result = computeTextStats('word '.repeat(150).trim());
    expect(result.speakingTimeMinutes).toBeCloseTo(1.0, 1);
  });

  it('returns zeros for empty string', () => {
    const result = computeTextStats('');
    expect(result.words).toBe(0);
    expect(result.chars).toBe(0);
  });

  it('computes avgWordLength', () => {
    const result = computeTextStats('cat dog');
    expect(result.avgWordLength).toBeGreaterThan(0);
  });
});

describe('text-stats — run()', () => {
  it('returns application/json blob', async () => {
    const input = new File(['Hello world. How are you?'], 'test.txt', { type: 'text/plain' });
    const [out] = await textStats.run([input], {}, makeCtx()) as Blob[];
    expect(out!.type).toBe('application/json');
    const data = JSON.parse(await out!.text());
    expect(data.words).toBeGreaterThan(0);
    expect(data.sentences).toBeGreaterThan(0);
    expect(typeof data.readingTimeMinutes).toBe('number');
    expect(typeof data.speakingTimeMinutes).toBe('number');
  });

  it('rejects when given 0 files', async () => {
    await expect(textStats.run([], {}, makeCtx())).rejects.toThrow();
  });

  it('handles multi-paragraph text', async () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const input = new File([text], 'para.txt', { type: 'text/plain' });
    const [out] = await textStats.run([input], {}, makeCtx()) as Blob[];
    const data = JSON.parse(await out!.text());
    expect(data.paragraphs).toBe(3);
  });

  it('counts syllables in result', async () => {
    const input = new File(['beautiful butterfly'], 'syl.txt', { type: 'text/plain' });
    const [out] = await textStats.run([input], {}, makeCtx()) as Blob[];
    const data = JSON.parse(await out!.text());
    expect(data.syllables).toBeGreaterThan(2);
  });
});
