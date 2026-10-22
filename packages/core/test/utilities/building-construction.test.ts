import { describe, expect, it } from 'vitest';
import {
  constructionEstimateGenerator,
  calculateConstructionEstimate,
  validateConstructionEstimate,
} from '../../src/utilities/building.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'construction-known-answer',
  onProgress() {},
});
async function output(params: Record<string, unknown>) {
  const result = await constructionEstimateGenerator.run([], params, context());
  return (Array.isArray(result) ? result[0] : result)!;
}
describe('construction estimate actual minor units and real PDF', () => {
  it('rounds fractional material/labor lines and percentages independently half-up', () => {
    const p = validateConstructionEstimate({
      materials: [{ description: 'fraction', quantity: 1.5, unit: 'each', unitPrice: 0.335 }],
      labor: [{ description: 'fraction', hours: 1.25, hourlyRate: 0.335 }],
    });
    expect(calculateConstructionEstimate(p)).toMatchObject({
      subtotalMinor: 92,
      markupMinor: 9,
      taxableMinor: 101,
      taxMinor: 5,
      totalMinor: 106,
    });
  });
  it('three half-cent lines total3 cents before rounded markup/tax', () => {
    const p = validateConstructionEstimate({
      materials: [1, 2, 3].map((i) => ({
        description: `line${i}`,
        quantity: 1,
        unit: 'each',
        unitPrice: 0.005,
      })),
      labor: [],
      markupPercent: 50,
      taxPercent: 10,
    });
    expect(calculateConstructionEstimate(p)).toMatchObject({
      subtotalMinor: 3,
      markupMinor: 2,
      taxMinor: 1,
      totalMinor: 6,
    });
  });
  it('rejects excess rounded discount, precision, dates and exact unknown row fields', () => {
    expect(() =>
      calculateConstructionEstimate(validateConstructionEstimate({ discount: 10000 })),
    ).toThrow(/discount/i);
    expect(() =>
      validateConstructionEstimate({
        materials: [{ description: 'x', quantity: 1.0000001, unit: 'each', unitPrice: 1 }],
      }),
    ).toThrow(/decimal/i);
    expect(() => validateConstructionEstimate({ issueDate: '2025-02-29' })).toThrow();
    expect(() =>
      validateConstructionEstimate({
        materials: [{ description: 'x', quantity: 1, unit: 'each', unitPrice: 1, unknown: 0 }],
      }),
    ).toThrow();
  });
  it('returns exact JSON components and unlimited-script Unicode as text', async () => {
    const artifact = await output({ customer: '中文 <script>literal</script>' });
    expect(artifact.type).toBe('application/json');
    expect(JSON.parse(await artifact.text())).toMatchObject({
      totalMinor: 10395,
      formattedTotals: { totalMinor: '103.95' },
      customer: '中文 <script>literal</script>',
    });
    expect(constructionEstimateGenerator.chainSuggestions).toEqual([]);
  });
  it('returns deterministic actual PDF bytes, fixed dates/ID and reopened customer/totals', async () => {
    const first = await output({ format: 'pdf' }),
      second = await output({ format: 'pdf' });
    expect(first.type).toBe('application/pdf');
    const bytes = new Uint8Array(await first.arrayBuffer());
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const reopened = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reopened.getCreationDate()?.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(reopened.getModificationDate()?.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(reopened.context.trailerInfo.ID?.toString()).toMatch(
      /^\[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]$/i,
    );
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      useSystemFonts: false,
    });
    try {
      const pdf = await loading.promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ');
      expect(text).toContain('Example customer');
      expect(text).toContain('103.95');
    } finally {
      await loading.destroy();
    }
  });
  it('reopens all100 material rows plus100 labor rows across actual PDF pages', async () => {
    const materials = Array.from({ length: 100 }, (_, i) => ({
        description: `MATERIAL-${i + 1}`,
        quantity: 1,
        unit: 'each',
        unitPrice: 1,
      })),
      labor = Array.from({ length: 100 }, (_, i) => ({
        description: `LABOR-${i + 1}`,
        hours: 1,
        hourlyRate: 1,
      }));
    const blob = await output({ format: 'pdf', materials, labor, issueDate: '2026-01-15' }),
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'),
      loading = pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        useSystemFonts: false,
      });
    try {
      const pdf = await loading.promise;
      expect(pdf.numPages).toBeGreaterThan(1);
      expect(pdf.numPages).toBeLessThanOrEqual(64);
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++)
        text += (await (await pdf.getPage(i)).getTextContent()).items
          .flatMap((item) => ('str' in item ? [item.str] : []))
          .join(' ');
      for (let i = 1; i <= 100; i++) {
        expect(text).toContain(`MATERIAL-${i} |`);
        expect(text).toContain(`LABOR-${i} |`);
      }
      expect(text).toContain('231.00');
    } finally {
      await loading.destroy();
    }
  });
  it('PDF refuses unsupported standard-font text without dropping it', async () => {
    await expect(output({ format: 'pdf', customer: '中文' })).rejects.toThrow(/font|WinAnsi/i);
  });
  it('PDF preserves actual multiline notes through line wrapping', async () => {
    expect((await output({ format: 'pdf', notes: 'First line\nSecond line' })).type).toBe(
      'application/pdf',
    );
  });
});
