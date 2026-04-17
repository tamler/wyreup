import { describe, it, expect } from 'vitest';
import { wordCounter } from '../../../src/tools/word-counter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { WordCounterResult } from '../../../src/tools/word-counter/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function count(text: string, type = 'text/plain'): Promise<WordCounterResult> {
  const input = new File([text], 'test.txt', { type });
  const [out] = await wordCounter.run([input], {}, makeCtx());
  return JSON.parse(await out!.text()) as WordCounterResult;
}

describe('word-counter — metadata', () => {
  it('has id word-counter', () => {
    expect(wordCounter.id).toBe('word-counter');
  });

  it('is in the inspect category', () => {
    expect(wordCounter.category).toBe('inspect');
  });

  it('accepts text/plain, text/html, text/markdown', () => {
    expect(wordCounter.input.accept).toContain('text/plain');
    expect(wordCounter.input.accept).toContain('text/html');
    expect(wordCounter.input.accept).toContain('text/markdown');
  });
});

describe('word-counter — run()', () => {
  it('counts words in English text', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const result = await count(text);
    expect(result.words).toBe(9);
    expect(result.characters).toBe(text.length);
    expect(result.sentences).toBeGreaterThanOrEqual(1);
  });

  it('handles empty input with all zeros', async () => {
    const result = await count('');
    expect(result.words).toBe(0);
    expect(result.characters).toBe(0);
    expect(result.charactersNoSpaces).toBe(0);
    expect(result.sentences).toBe(0);
    expect(result.paragraphs).toBe(0);
    expect(result.lines).toBe(0);
    expect(result.readingTimeMinutes).toBe(0);
  });

  it('counts lines correctly', async () => {
    const text = 'line 1\nline 2\nline 3';
    const result = await count(text);
    expect(result.lines).toBe(3);
  });

  it('reading time is ~1 min for 200 words', async () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const result = await count(words);
    expect(result.words).toBeGreaterThanOrEqual(195);
    expect(result.readingTimeMinutes).toBeCloseTo(1, 0);
  });

  it('counts characters without spaces', async () => {
    const result = await count('hello world');
    expect(result.characters).toBe(11);
    expect(result.charactersNoSpaces).toBe(10);
  });

  it('strips HTML tags before counting', async () => {
    const html = '<h1>Hello</h1><p>World</p>';
    const result = await count(html, 'text/html');
    expect(result.words).toBe(2);
  });
});
