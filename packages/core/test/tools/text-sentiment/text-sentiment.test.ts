import { describe, it, expect } from 'vitest';
import { textSentiment } from '../../../src/tools/text-sentiment/index.js';

describe('text-sentiment — metadata', () => {
  it('has id text-sentiment', () => {
    expect(textSentiment.id).toBe('text-sentiment');
  });

  it('is in the text category', () => {
    expect(textSentiment.category).toBe('text');
  });

  it('accepts text/plain', () => {
    expect(textSentiment.input.accept).toContain('text/plain');
  });

  it('outputs application/json', () => {
    expect(textSentiment.output.mime).toBe('application/json');
  });

  it('has installSize ~65 MB', () => {
    expect(textSentiment.installSize).toBe(65_000_000);
  });

  it('has installGroup nlp-standard', () => {
    expect((textSentiment as unknown as { installGroup: string }).installGroup).toBe('nlp-standard');
  });

  it('requires webgpu preferred', () => {
    expect(textSentiment.requires?.webgpu).toBe('preferred');
  });

  it('accepts exactly 1 file', () => {
    expect(textSentiment.input.min).toBe(1);
    expect(textSentiment.input.max).toBe(1);
  });
});
