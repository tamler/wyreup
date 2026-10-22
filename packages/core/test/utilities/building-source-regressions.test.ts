import { describe, expect, it } from 'vitest';
import {
  constructionEstimateGenerator,
  validateBoardFootPieces,
  validateGutterCandidates,
} from '../../src/utilities/building.js';
import { validateGeneratorLoads } from '../../src/utilities/hardware.js';
import type { ToolRunContext } from '../../src/types.js';

describe('independently found building row and PDF display regressions', () => {
  it.each(['toString', '__proto__', 'constructor'])(
    'rejects inherited column name %s as an exact unknown column',
    (key) => {
      for (const [check, row, field] of [
        [
          validateBoardFootPieces,
          { thicknessIn: 1, widthIn: 12, lengthFt: 8, quantity: 1, pricePerBoardFoot: 3 },
          'pieces',
        ],
        [validateGutterCandidates, { name: 'x', widthM: 1, waterDepthM: 1 }, 'candidates'],
        [validateGeneratorLoads, { name: 'x', runningW: 1, startingW: 1, quantity: 1 }, 'loads'],
      ] as const) {
        Object.defineProperty(row, key, { value: 'unknown', enumerable: true });
        let error: unknown;
        try {
          check([row]);
        } catch (caught) {
          error = caught;
        }
        expect(error).toMatchObject({ field: `$.${field}[0].${key}`, code: 'unknown' });
      }
    },
  );
  it('prints integer-minor-unit line totals with exactly two decimals, retaining entered six-decimal-capable rates', async () => {
    const ctx: ToolRunContext = {
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'pdf-line-display',
      onProgress() {},
    };
    const result = await constructionEstimateGenerator.run(
        [],
        {
          format: 'pdf',
          materials: [{ description: 'M', quantity: 1, unit: 'each', unitPrice: 0.5 }],
          labor: [{ description: 'L', hours: 1, hourlyRate: 0.5 }],
        },
        ctx,
      ),
      blob = Array.isArray(result) ? result[0] : result;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'),
      loading = pdfjs.getDocument({
        data: new Uint8Array(await blob!.arrayBuffer()),
        useSystemFonts: false,
      });
    try {
      const pdf = await loading.promise,
        text = (await (await pdf.getPage(1)).getTextContent()).items
          .flatMap((item) => ('str' in item ? [item.str] : []))
          .join(' ');
      expect(text).toContain('each @ 0.5 | 0.50');
      expect(text).toContain('hours @ 0.5 | 0.50');
    } finally {
      await loading.destroy();
    }
  });
});
