import { describe, it, expect } from 'vitest';
import { textNer } from '../../../src/tools/text-ner/index.js';

describe('text-ner — metadata', () => {
  it('has id text-ner', () => {
    expect(textNer.id).toBe('text-ner');
  });

  it('is in the text category', () => {
    expect(textNer.category).toBe('text');
  });

  it('accepts text/plain', () => {
    expect(textNer.input.accept).toContain('text/plain');
  });

  it('outputs application/json', () => {
    expect(textNer.output.mime).toBe('application/json');
  });

  it('has installSize ~110 MB', () => {
    expect(textNer.installSize).toBe(110_000_000);
  });

  it('has installGroup nlp-standard', () => {
    expect((textNer as unknown as { installGroup: string }).installGroup).toBe('nlp-standard');
  });

  it('requires webgpu preferred', () => {
    expect(textNer.requires?.webgpu).toBe('preferred');
  });
});
