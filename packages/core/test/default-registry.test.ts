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
});
