import { describe, it, expect } from 'vitest';
import { htmlToPdf } from '../../../src/tools/html-to-pdf/index.js';
import { makeCtx, makeHtmlFile } from '../excel-helpers.js';

// html-to-pdf requires a browser DOM (html2canvas needs document).
// In Node/CI, run() throws a clear descriptive error — we test that contract.

const SAMPLE_HTML = '<html><body><h1>Hello</h1></body></html>';

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('html-to-pdf — metadata', () => {
  it('has id html-to-pdf', () => expect(htmlToPdf.id).toBe('html-to-pdf'));
  it('is in convert category', () => expect(htmlToPdf.category).toBe('convert'));
  it('outputs application/pdf', () => expect(htmlToPdf.output.mime).toBe('application/pdf'));
  it('accepts text/html', () => expect(htmlToPdf.input.accept).toContain('text/html'));
  it('has paramSchema', () => expect(htmlToPdf.paramSchema).toBeDefined());
  it('has all expected params', () => {
    expect(htmlToPdf.paramSchema?.pageSize).toBeDefined();
    expect(htmlToPdf.paramSchema?.orientation).toBeDefined();
    expect(htmlToPdf.paramSchema?.margin).toBeDefined();
    expect(htmlToPdf.paramSchema?.scale).toBeDefined();
  });
  it('defaults to A4 portrait', () => {
    expect(htmlToPdf.defaults.pageSize).toBe('A4');
    expect(htmlToPdf.defaults.orientation).toBe('portrait');
  });
  it('margin range is 0-50 mm', () => {
    const marginSchema = htmlToPdf.paramSchema?.margin;
    expect(marginSchema?.type).toBe('range');
    if (marginSchema?.type === 'range') {
      expect(marginSchema.min).toBe(0);
      expect(marginSchema.max).toBe(50);
    }
  });
});

// ── Node environment guard ────────────────────────────────────────────────────

describe('html-to-pdf — Node environment guard', () => {
  it('throws a clear error about browser requirement in Node', async () => {
    // In Node.js, `document` is undefined — the tool should throw a descriptive error
    const file = makeHtmlFile(SAMPLE_HTML);
    await expect(
      htmlToPdf.run([file], {}, makeCtx()),
    ).rejects.toThrow(/browser/i);
  });
});
