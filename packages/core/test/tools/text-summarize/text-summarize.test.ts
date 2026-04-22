import { describe, it, expect } from 'vitest';
import { textSummarize } from '../../../src/tools/text-summarize/index.js';

describe('text-summarize — metadata', () => {
  it('has id text-summarize', () => {
    expect(textSummarize.id).toBe('text-summarize');
  });

  it('is in the text category', () => {
    expect(textSummarize.category).toBe('text');
  });

  it('accepts text/plain', () => {
    expect(textSummarize.input.accept).toContain('text/plain');
  });

  it('outputs text/plain', () => {
    expect(textSummarize.output.mime).toBe('text/plain');
  });

  it('has installSize ~80 MB', () => {
    expect(textSummarize.installSize).toBe(80_000_000);
  });

  it('has installGroup nlp-standard', () => {
    expect((textSummarize as unknown as { installGroup: string }).installGroup).toBe('nlp-standard');
  });

  it('defaults maxLength to 100', () => {
    expect(textSummarize.defaults.maxLength).toBe(100);
  });

  it('defaults minLength to 30', () => {
    expect(textSummarize.defaults.minLength).toBe(30);
  });

  it('rejects invalid params (maxLength < minLength) at run time', async () => {
    const ctx = {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'test',
    };
    const input = new File(['Hello world.'], 'test.txt', { type: 'text/plain' });
    await expect(
      textSummarize.run([input], { maxLength: 10, minLength: 50 }, ctx),
    ).rejects.toThrow();
  });
});
