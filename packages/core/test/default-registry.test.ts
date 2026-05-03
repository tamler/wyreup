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

  it('has 127 tools in total', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.size).toBe(127);
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

  it('includes convert-audio', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('convert-audio')).toBeDefined();
  });

  it('includes convert-video', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('convert-video')).toBeDefined();
  });

  it('includes extract-audio', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('extract-audio')).toBeDefined();
  });

  it('includes trim-media', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('trim-media')).toBeDefined();
  });

  it('includes compress-video', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('compress-video')).toBeDefined();
  });

  it('includes video-to-gif', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-to-gif')).toBeDefined();
  });

  it('includes convert-subtitles', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('convert-subtitles')).toBeDefined();
  });

  it('includes burn-subtitles', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('burn-subtitles')).toBeDefined();
  });

  it('has a media category with tools', () => {
    const registry = createDefaultRegistry();
    const mediaTools = registry.toolsByCategory('media');
    expect(mediaTools.length).toBeGreaterThan(0);
  });

  it('includes pgp-encrypt', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pgp-encrypt')).toBeDefined();
  });

  it('includes pgp-decrypt', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pgp-decrypt')).toBeDefined();
  });

  it('includes pgp-sign', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pgp-sign')).toBeDefined();
  });

  it('includes pgp-verify', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('pgp-verify')).toBeDefined();
  });

  it('includes zip-create', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('zip-create')).toBeDefined();
  });

  it('includes zip-extract', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('zip-extract')).toBeDefined();
  });

  it('includes zip-info', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('zip-info')).toBeDefined();
  });

  it('has an archive category with tools', () => {
    const registry = createDefaultRegistry();
    const archiveTools = registry.toolsByCategory('archive');
    expect(archiveTools.length).toBeGreaterThan(0);
  });

  // Wave L: image AI tools
  it('includes bg-remove', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('bg-remove')).toBeDefined();
  });

  it('includes upscale-2x', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('upscale-2x')).toBeDefined();
  });

  it('includes ocr-pro', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('ocr-pro')).toBeDefined();
  });

  it('includes image-similarity', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('image-similarity')).toBeDefined();
  });

  it('image-ai group tools have installGroup set', () => {
    const registry = createDefaultRegistry();
    const aiTools = ['bg-remove', 'upscale-2x', 'ocr-pro', 'image-similarity'];
    for (const id of aiTools) {
      const tool = registry.toolsById.get(id) as { installGroup?: string } | undefined;
      expect(tool?.installGroup).toBe('image-ai');
    }
  });

  // Wave L: NLP tools
  it('includes text-sentiment', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-sentiment')).toBeDefined();
  });

  it('includes text-ner', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-ner')).toBeDefined();
  });

  it('includes text-summarize', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-summarize')).toBeDefined();
  });

  it('includes text-translate', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-translate')).toBeDefined();
  });

  it('includes text-embed', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-embed')).toBeDefined();
  });

  it('text-translate has its own installGroup (nlp-translate)', () => {
    const registry = createDefaultRegistry();
    const tool = registry.toolsById.get('text-translate') as { installGroup?: string } | undefined;
    expect(tool?.installGroup).toBe('nlp-translate');
  });

  it('nlp-standard group tools have correct installGroup', () => {
    const registry = createDefaultRegistry();
    const nlpStandard = ['text-sentiment', 'text-ner', 'text-summarize', 'text-embed'];
    for (const id of nlpStandard) {
      const tool = registry.toolsById.get(id) as { installGroup?: string } | undefined;
      expect(tool?.installGroup).toBe('nlp-standard');
    }
  });

  // Wave L: pure-JS text tools
  it('includes text-readability', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-readability')).toBeDefined();
  });

  it('includes text-stats', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-stats')).toBeDefined();
  });

  it('includes token-count', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('token-count')).toBeDefined();
  });

  it('includes text-diff-levenshtein', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-diff-levenshtein')).toBeDefined();
  });

  it('includes unicode-normalize', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('unicode-normalize')).toBeDefined();
  });

  it('includes text-escape', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('text-escape')).toBeDefined();
  });

  it('pure-JS text tools have no installSize', () => {
    const registry = createDefaultRegistry();
    const pureTools = ['text-readability', 'text-stats', 'token-count', 'text-diff-levenshtein', 'unicode-normalize', 'text-escape'];
    for (const id of pureTools) {
      const tool = registry.toolsById.get(id);
      expect(tool?.installSize).toBeUndefined();
    }
  });

  it('has a text category with tools', () => {
    const registry = createDefaultRegistry();
    const textTools = registry.toolsByCategory('text');
    expect(textTools.length).toBeGreaterThan(0);
  });

  // Wave M: video edit primitives
  it('includes video-concat', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-concat')).toBeDefined();
  });

  it('includes video-add-text', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-add-text')).toBeDefined();
  });

  it('includes video-speed', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-speed')).toBeDefined();
  });

  it('includes video-overlay-image', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-overlay-image')).toBeDefined();
  });

  it('includes video-crossfade', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-crossfade')).toBeDefined();
  });

  it('includes video-color-correct', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('video-color-correct')).toBeDefined();
  });

  it('wave-m tools share the ffmpeg installGroup', () => {
    const registry = createDefaultRegistry();
    const waveM = ['video-concat', 'video-add-text', 'video-speed', 'video-overlay-image', 'video-crossfade', 'video-color-correct'];
    for (const id of waveM) {
      const tool = registry.toolsById.get(id) as { installGroup?: string } | undefined;
      expect(tool?.installGroup).toBe('ffmpeg');
    }
  });

  // Wave N: Excel I/O tools
  it('includes excel-to-csv', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('excel-to-csv')).toBeDefined();
  });

  it('includes excel-to-json', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('excel-to-json')).toBeDefined();
  });

  it('includes csv-to-excel', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('csv-to-excel')).toBeDefined();
  });

  it('includes json-to-excel', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('json-to-excel')).toBeDefined();
  });

  it('includes excel-info', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('excel-info')).toBeDefined();
  });

  it('includes merge-workbooks', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('merge-workbooks')).toBeDefined();
  });

  it('includes split-sheets', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('split-sheets')).toBeDefined();
  });

  it('excel tools are in convert/inspect/edit categories', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('excel-to-csv')?.category).toBe('convert');
    expect(registry.toolsById.get('excel-to-json')?.category).toBe('convert');
    expect(registry.toolsById.get('csv-to-excel')?.category).toBe('convert');
    expect(registry.toolsById.get('json-to-excel')?.category).toBe('convert');
    expect(registry.toolsById.get('excel-info')?.category).toBe('inspect');
    expect(registry.toolsById.get('merge-workbooks')?.category).toBe('edit');
    expect(registry.toolsById.get('split-sheets')?.category).toBe('edit');
  });

  // Wave N: HTML-to-PDF
  it('includes html-to-pdf', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('html-to-pdf')).toBeDefined();
  });

  it('html-to-pdf is in the convert category', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('html-to-pdf')?.category).toBe('convert');
  });

  // Wave N: Barcode
  it('includes barcode', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('barcode')).toBeDefined();
  });

  it('barcode is in the create category', () => {
    const registry = createDefaultRegistry();
    expect(registry.toolsById.get('barcode')?.category).toBe('create');
  });
});
