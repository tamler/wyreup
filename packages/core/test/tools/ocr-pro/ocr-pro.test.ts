import { describe, it, expect } from 'vitest';
import { ocrPro } from '../../../src/tools/ocr-pro/index.js';

describe('ocr-pro — metadata', () => {
  it('has id ocr-pro', () => {
    expect(ocrPro.id).toBe('ocr-pro');
  });

  it('is in the export category', () => {
    expect(ocrPro.category).toBe('export');
  });

  it('accepts image types', () => {
    expect(ocrPro.input.accept).toContain('image/jpeg');
    expect(ocrPro.input.accept).toContain('image/png');
  });

  it('outputs text/plain', () => {
    expect(ocrPro.output.mime).toBe('text/plain');
  });

  it('has installSize ~150 MB', () => {
    expect(ocrPro.installSize).toBe(150_000_000);
  });

  it('has installGroup image-ai', () => {
    expect((ocrPro as unknown as { installGroup: string }).installGroup).toBe('image-ai');
  });

  it('requires webgpu preferred', () => {
    expect(ocrPro.requires?.webgpu).toBe('preferred');
  });

  it('accepts exactly 1 file', () => {
    expect(ocrPro.input.min).toBe(1);
    expect(ocrPro.input.max).toBe(1);
  });
});
