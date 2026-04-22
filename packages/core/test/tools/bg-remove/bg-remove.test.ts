import { describe, it, expect } from 'vitest';
import { bgRemove } from '../../../src/tools/bg-remove/index.js';

describe('bg-remove — metadata', () => {
  it('has id bg-remove', () => {
    expect(bgRemove.id).toBe('bg-remove');
  });

  it('is in the privacy category', () => {
    expect(bgRemove.category).toBe('privacy');
  });

  it('accepts image/* types', () => {
    expect(bgRemove.input.accept).toContain('image/jpeg');
    expect(bgRemove.input.accept).toContain('image/png');
  });

  it('outputs image/png', () => {
    expect(bgRemove.output.mime).toBe('image/png');
  });

  it('has installSize ~100 MB', () => {
    expect(bgRemove.installSize).toBe(100_000_000);
  });

  it('has installGroup image-ai', () => {
    expect((bgRemove as unknown as { installGroup: string }).installGroup).toBe('image-ai');
  });

  it('requires webgpu preferred', () => {
    expect(bgRemove.requires?.webgpu).toBe('preferred');
  });

  it('accepts exactly 1 file', () => {
    expect(bgRemove.input.min).toBe(1);
    expect(bgRemove.input.max).toBe(1);
  });

  it('defaults outputFormat to png', () => {
    expect(bgRemove.defaults.outputFormat).toBe('png');
  });
});
