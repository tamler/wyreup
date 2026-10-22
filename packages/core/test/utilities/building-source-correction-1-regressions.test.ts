import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildingTools, constructionEstimateGenerator } from '../../src/utilities/building.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  executionId: 'independent-building-source-regression',
  cache: new Map(),
  onProgress() {},
});

async function wallpaper(params: Record<string, unknown>) {
  const tool = buildingTools.find((candidate) => candidate.id === 'wallpaper-roll-calculator');
  if (!tool) throw new Error('Actual wallpaper tool is unavailable.');
  const output = await tool.run([], params, context());
  const blob = (Array.isArray(output) ? output[0] : output)!;
  expect(blob.type).toBe('application/json');
  return JSON.parse(await blob.text()) as Record<string, unknown>;
}

describe('independent building source correction regressions', () => {
  it.each([
    ['no pattern repeat', 0],
    ['three exact 0.9m pattern repeats', 0.9],
  ] as const)('fits three 2.7m strips in an 8.1m roll: %s', async (_label, patternRepeatM) => {
    // Integer millimetres give 8100 / (2500 + 2 * 100) = 3 exactly.
    // For the repeat control, ceil(2700 / 900) * 900 = 2700 exactly.
    // The 10m perimeter / 0.5m width needs 20 strips, ceil(20 / 3) = 7 rolls.
    const result = await wallpaper({
      wallPerimeterM: 10,
      rollWidthM: 0.5,
      heightM: 2.5,
      trimEachEndM: 0.1,
      rollLengthM: 8.1,
      patternRepeatM,
      extraRolls: 0,
    });
    expect(result.cutHeightM).toBeCloseTo(2.7, 12);
    expect(result).toMatchObject({ strips: 20, stripsPerRoll: 3, baseRolls: 7, rolls: 7 });
  });

  it.each([0, 0.9])(
    'does not snap a genuinely short 8.09m roll upward (repeat %s)',
    async (patternRepeatM) => {
      // 8090mm < 3 * 2700mm, hence only two full strips and ten rolls.
      expect(
        await wallpaper({
          wallPerimeterM: 10,
          rollWidthM: 0.5,
          heightM: 2.5,
          trimEachEndM: 0.1,
          rollLengthM: 8.09,
          patternRepeatM,
          extraRolls: 0,
        }),
      ).toMatchObject({ strips: 20, stripsPerRoll: 2, baseRolls: 10, rolls: 10 });
    },
  );

  it.each([
    ['long', 'W'.repeat(120)],
    ['multiline', `${'W'.repeat(100)}\n${'X'.repeat(19)}`],
  ] as const)(
    'keeps %s continuation title within the 510pt content width and above body text',
    async (label, title) => {
      const output = await constructionEstimateGenerator.run(
        [],
        {
          format: 'pdf',
          title,
          materials: Array.from({ length: 100 }, (_, index) => ({
            description: `Original line ${index + 1} ${'W'.repeat(75)}`,
            quantity: 1,
            unit: 'each',
            unitPrice: 1,
          })),
          labor: [],
        },
        context(),
      );
      const blob = (Array.isArray(output) ? output[0] : output)!;
      expect(blob.type).toBe('application/pdf');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
      const fontDocument = await PDFDocument.create();
      const font = await fontDocument.embedFont(StandardFonts.Helvetica);
      const originalHeader = `${title} | USD | Line items / totals`;
      const originalLogicalWidths = originalHeader
        .split('\n')
        .map((line) => font.widthOfTextAtSize(line, 10));
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loading = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
      try {
        const pdf = await loading.promise;
        expect(pdf.numPages).toBeGreaterThan(1);
        const page = await pdf.getPage(2);
        const content = await page.getTextContent();
        const items = content.items.flatMap((item) =>
          'str' in item && item.str
            ? [
                {
                  text: item.str,
                  width: item.width,
                  x: Number(item.transform[4]),
                  y: Number(item.transform[5]),
                },
              ]
            : [],
        );
        const evidenceDirectory = process.env.WYREUP_BUILDING_PROBE_DIR;
        if (evidenceDirectory) {
          await mkdir(evidenceDirectory, { recursive: true });
          await writeFile(`${evidenceDirectory}/construction-${label}-title.pdf`, bytes);
          await writeFile(
            `${evidenceDirectory}/construction-${label}-title-positions.json`,
            JSON.stringify(
              {
                title,
                pageCount: pdf.numPages,
                pageWidth: page.view[2],
                allowedContentWidth: 510,
                originalLogicalWidths,
                page2Items: items,
              },
              null,
              2,
            ),
          );
        }
        const first = items[0];
        expect(first).toBeDefined();
        expect(first!.text).toContain(' | USD | Line items / totals');
        expect(first!.text).not.toContain('\n');
        expect(first!.x).toBe(40);
        expect(first!.width).toBeLessThanOrEqual(510);
        expect(items.slice(1).every((item) => item.y <= first!.y - 15)).toBe(true);
      } finally {
        await loading.destroy();
      }
    },
    30000,
  );
});
