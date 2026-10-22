import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { PDFDocument as PdfDocumentClass } from '../../core/node_modules/@cantoo/pdf-lib';
import type * as Pdfjs from '../../core/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const coreRequire = createRequire(new URL('../../core/package.json', import.meta.url));
const { PDFDocument } = coreRequire('@cantoo/pdf-lib') as { PDFDocument: typeof PdfDocumentClass };
import { openBrowserHarness } from './browserHarness';
describe('mounted actual construction estimate editor and exports', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('shows validated totals, editable rows and actual matching JSON/PDF downloads', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=construction-estimate-generator`);
      await page.getByText('Validated estimate preview', { exact: true }).waitFor();
      await page.getByLabel('materials Description 1').fill('<script>alert(1)</script>');
      expect(await page.locator('script:not([src])').count()).toBe(0);
      await page.getByLabel('materials Quantity 1').fill('');
      expect(
        await page.getByRole('button', { name: 'Download JSON', exact: true }).isDisabled(),
      ).toBe(true);
      expect(await page.getByRole('alert').textContent()).toContain('$.materials[0].quantity');
      await page.getByLabel('materials Quantity 1').fill('10');
      await page.getByRole('button', { name: 'Add labor row' }).focus();
      await page.keyboard.press('Enter');
      await page.getByLabel('labor Hours 2').fill('0');
      await page.getByRole('button', { name: 'Remove labor row 2' }).focus();
      await page.keyboard.press('Enter');
      const jsonEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
      const jsonPath = await (await jsonEvent).path();
      if (!jsonPath) throw new Error('No JSON');
      const estimate = JSON.parse(await readFile(jsonPath, 'utf8')) as Record<string, unknown>;
      expect(estimate).toMatchObject({ totalMinor: 10395, currency: 'USD' });
      const pdfEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
      const pdfPath = await (await pdfEvent).path();
      if (!pdfPath) throw new Error('No PDF');
      const bytes = await readFile(pdfPath);
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      const pdfjs = (await import(
        coreRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')
      )) as typeof Pdfjs;
      const loading = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
      try {
        const document = await loading.promise;
        const text = (await (await document.getPage(1)).getTextContent()).items
          .flatMap((item) => ('str' in item ? [item.str] : []))
          .join(' ');
        expect(text).toContain('103.95');
        expect(text).toContain('<script>alert(1)</script>');
      } finally {
        await loading.destroy();
      }
      await page.setViewportSize({ width: 375, height: 812 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 30000);
  it('keeps Unicode JSON truthful while visibly refusing unsupported PDF glyphs', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=construction-estimate-generator`);
      await page.getByLabel('materials Description 1').fill('東京');
      const jsonEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
      const path = await (await jsonEvent).path();
      if (!path) throw new Error('No JSON');
      expect(await readFile(path, 'utf8')).toContain('東京');
      await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('alert').textContent()).toMatch(/glyph|WinAnsi/i);
    } finally {
      await page.close();
    }
  }, 30000);
  it('clears deferred download on edits and absorbs unmounted late errors', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(`${harness.url}?id=construction-estimate-generator&defer=1`);
      await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      await page.getByLabel('materials Quantity 1').fill('2');
      expect(await page.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(0);
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      await page.evaluate(() =>
        (window as unknown as { buildingProbe: { reject(): void } }).buildingProbe.reject(),
      );
      await page.waitForTimeout(30);
      expect(errors).toEqual([]);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { buildingProbe: { aborted: number } }).buildingProbe.aborted,
        ),
      ).toBe(1);
    } finally {
      await page.close();
    }
  }, 30000);
});
