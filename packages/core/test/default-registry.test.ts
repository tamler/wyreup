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

  it('has 72 tools in total', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.size).toBe(72);
  });

  it('includes ocr', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('ocr')).toBeDefined();
  });

  it('includes svg-to-png', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('svg-to-png')).toBeDefined();
  });

  it('includes timestamp-converter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('timestamp-converter')).toBeDefined();
  });

  it('includes lorem-ipsum', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('lorem-ipsum')).toBeDefined();
  });

  it('includes regex-tester', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('regex-tester')).toBeDefined();
  });

  it('includes face-blur', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('face-blur')).toBeDefined();
  });

  it('includes audio-enhance', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('audio-enhance')).toBeDefined();
  });

  it('includes csv-json', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('csv-json')).toBeDefined();
  });

  it('includes case-converter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('case-converter')).toBeDefined();
  });

  it('includes slug', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('slug')).toBeDefined();
  });

  it('includes json-yaml', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('json-yaml')).toBeDefined();
  });

  it('includes number-base-converter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('number-base-converter')).toBeDefined();
  });

  it('includes jwt-decoder', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('jwt-decoder')).toBeDefined();
  });

  it('includes sql-formatter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('sql-formatter')).toBeDefined();
  });

  it('includes xml-formatter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('xml-formatter')).toBeDefined();
  });

  it('includes html-formatter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('html-formatter')).toBeDefined();
  });

  it('includes css-formatter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('css-formatter')).toBeDefined();
  });

  it('includes cron-parser', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('cron-parser')).toBeDefined();
  });

  it('includes qr-reader', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('qr-reader')).toBeDefined();
  });

  it('includes svg-optimizer', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('svg-optimizer')).toBeDefined();
  });

  it('has a dev category with tools', () => {
    const registry = createDefaultRegistry();
    const devTools = registry.toolsByCategory('dev');
    expect(devTools.length).toBeGreaterThan(0);
  });

  it('includes calculator', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('calculator')).toBeDefined();
  });

  it('includes unit-converter', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('unit-converter')).toBeDefined();
  });

  it('includes percentage-calculator', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('percentage-calculator')).toBeDefined();
  });

  it('includes date-calculator', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('date-calculator')).toBeDefined();
  });

  it('includes compound-interest', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('compound-interest')).toBeDefined();
  });

  it('includes investment-dca', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('investment-dca')).toBeDefined();
  });

  it('has a finance category with tools', () => {
    const registry = createDefaultRegistry();
    const financeTools = registry.toolsByCategory('finance');
    expect(financeTools.length).toBeGreaterThan(0);
  });
});
