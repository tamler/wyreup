import { describe, it, expect } from 'vitest';
import { upscale2x } from '../../../src/tools/upscale-2x/index.js';

describe('upscale-2x — metadata', () => {
  it('has id upscale-2x', () => {
    expect(upscale2x.id).toBe('upscale-2x');
  });

  it('is in the optimize category', () => {
    expect(upscale2x.category).toBe('optimize');
  });

  it('accepts image types', () => {
    expect(upscale2x.input.accept).toContain('image/jpeg');
    expect(upscale2x.input.accept).toContain('image/png');
  });

  it('outputs image/png', () => {
    expect(upscale2x.output.mime).toBe('image/png');
  });

  it('has installSize ~22 MB', () => {
    expect(upscale2x.installSize).toBe(22_000_000);
  });

  it('has installGroup image-ai', () => {
    expect((upscale2x as unknown as { installGroup: string }).installGroup).toBe('image-ai');
  });

  it('requires webgpu preferred', () => {
    expect(upscale2x.requires?.webgpu).toBe('preferred');
  });

  it('has empty defaults', () => {
    expect(upscale2x.defaults).toEqual({});
  });
});
