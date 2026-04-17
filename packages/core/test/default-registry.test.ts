import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../src/default-registry.js';

describe('default registry', () => {
  it('includes compress', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('compress')).toBeDefined();
  });

  it('exposes compress via category filter', () => {
    const registry = createDefaultRegistry();
    const optimizeTools = registry.toolsByCategory('optimize');
    expect(optimizeTools.some((t) => t.id === 'compress')).toBe(true);
  });

  it('compress is findable via search by keyword', () => {
    const registry = createDefaultRegistry();
    const results = registry.searchTools('shrink');
    expect(results.some((t) => t.id === 'compress')).toBe(true);
  });

  it('compress is compatible with dropped JPEG files', () => {
    const registry = createDefaultRegistry();
    const jpg = new File([], 'x.jpg', { type: 'image/jpeg' });
    const compatible = registry.toolsForFiles([jpg]);
    expect(compatible.some((t) => t.id === 'compress')).toBe(true);
  });

  it('includes convert', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('convert')).toBeDefined();
  });

  it('includes strip-exif', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('strip-exif')).toBeDefined();
  });

  it('includes image-to-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('image-to-pdf')).toBeDefined();
  });

  it('includes merge-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('merge-pdf')).toBeDefined();
  });

  it('merge-pdf is compatible when 2 PDFs are dropped', () => {
    const registry = createDefaultRegistry();
    const pdf1 = new File([], 'a.pdf', { type: 'application/pdf' });
    const pdf2 = new File([], 'b.pdf', { type: 'application/pdf' });
    const compatible = registry.toolsForFiles([pdf1, pdf2]);
    expect(compatible.some((t) => t.id === 'merge-pdf')).toBe(true);
  });

  it('includes split-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('split-pdf')).toBeDefined();
  });

  it('includes rotate-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('rotate-pdf')).toBeDefined();
  });

  it('includes reorder-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('reorder-pdf')).toBeDefined();
  });

  it('includes page-numbers-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('page-numbers-pdf')).toBeDefined();
  });

  it('includes color-palette', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('color-palette')).toBeDefined();
  });

  it('includes qr', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('qr')).toBeDefined();
  });

  it('includes watermark-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('watermark-pdf')).toBeDefined();
  });

  it('includes pdf-to-text', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pdf-to-text')).toBeDefined();
  });

  it('includes image-diff', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('image-diff')).toBeDefined();
  });

  it('includes rotate-image', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('rotate-image')).toBeDefined();
  });

  it('includes flip-image', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('flip-image')).toBeDefined();
  });

  it('includes grayscale', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('grayscale')).toBeDefined();
  });

  it('includes sepia', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('sepia')).toBeDefined();
  });

  it('includes invert', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('invert')).toBeDefined();
  });

  it('includes image-info', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('image-info')).toBeDefined();
  });

  it('includes pdf-info', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pdf-info')).toBeDefined();
  });

  it('includes hash', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('hash')).toBeDefined();
  });

  it('includes crop', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('crop')).toBeDefined();
  });

  it('includes resize', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('resize')).toBeDefined();
  });

  it('includes image-watermark', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('image-watermark')).toBeDefined();
  });

  it('includes favicon', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('favicon')).toBeDefined();
  });

  it('includes pdf-to-image', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pdf-to-image')).toBeDefined();
  });

  it('has 27 tools in total', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.size).toBe(27);
  });
});
