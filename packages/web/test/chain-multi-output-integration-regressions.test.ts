import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type * as PdfLib from '../../core/node_modules/pdf-lib';
const { PDFDocument, StandardFonts } = createRequire(
  new URL('../../core/package.json', import.meta.url),
)('pdf-lib') as typeof PdfLib;
import { openMediaCallerHarness } from './mediaCallerHarness';
let harness: Awaited<ReturnType<typeof openMediaCallerHarness>>;
let original: Uint8Array;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-01-01T00:00:00.000Z'));
  pdf.setModificationDate(new Date('2026-01-01T00:00:00.000Z'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([200, 300]).drawText('Original page ONE', { x: 20, y: 100, font, size: 12 });
  pdf.addPage([400, 500]).drawText('Original page TWO', { x: 20, y: 100, font, size: 12 });
  original = await pdf.save();
  harness = await openMediaCallerHarness('./test/fixtures/MultiOutputCallerHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});

async function assertPage(bytes: Uint8Array, dimensions: [number, number]) {
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect([width, height]).toEqual(dimensions);
}

for (const caller of ['chain', 'builder']) {
  it(`${caller} retains every genuine split-pdf output with the existing first download and additional download`, async () => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(harness.url + `?caller=${caller}&steps=split-pdf`);
      const choosing = page.waitForEvent('filechooser');
      await page
        .getByRole('button', {
          name:
            caller === 'chain'
              ? 'Drop a file to run this chain'
              : 'Drop input file or click to browse',
          exact: true,
        })
        .click();
      await (
        await choosing
      ).setFiles({
        name: 'original.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(original),
      });
      await page.getByRole('button', { name: 'Run chain', exact: true }).click();
      await page.getByRole('button', { name: 'Download result', exact: true }).waitFor();
      expect(
        await page.evaluate(
          () => (window as unknown as { realSplitOutputs: Blob[] }).realSplitOutputs.length,
        ),
      ).toBe(2);
      const firstPending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download result', exact: true }).click();
      const firstPath = await (await firstPending).path();
      if (!firstPath) throw new Error('First real producer output missing.');
      await assertPage(await readFile(firstPath), [200, 300]);
      const second = page.getByRole('button', { name: 'Download output 2', exact: true });
      expect(await second.count()).toBe(1);
      const secondPending = page.waitForEvent('download');
      await second.click();
      const secondPath = await (await secondPending).path();
      if (!secondPath) throw new Error('Second real producer output missing.');
      await assertPage(await readFile(secondPath), [400, 500]);
    } finally {
      await page.close();
    }
  }, 20000);
}

it('batch archives all four genuine split-pdf outputs with per-input/output collision-safe indexes', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(3000);
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-owned-multiple-pdf-'));
  await writeFile(join(directory, 'a.pdf'), original);
  await writeFile(join(directory, 'b.pdf'), original);
  try {
    await page.goto(harness.url + '?caller=batch');
    await page.getByText('Or run on every file in a folder', { exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder…', exact: true }).click();
    await (await choosing).setFiles(directory);
    await page.getByRole('button', { name: 'Run on 2 files', exact: true }).click();
    await page.getByRole('button', { name: /Download ZIP/ }).waitFor();
    expect(
      await page.evaluate(
        () => (window as unknown as { realSplitOutputs: Blob[] }).realSplitOutputs.length,
      ),
    ).toBe(4);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download ZIP/ }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error('Actual batch archive missing.');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await readFile(path));
    const entries = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(entries.map((entry) => entry.name)).toEqual([
      'Wyreup-output/input-1/output-1.pdf',
      'Wyreup-output/input-1/output-2.pdf',
      'Wyreup-output/input-2/output-1.pdf',
      'Wyreup-output/input-2/output-2.pdf',
    ]);
    for (let index = 0; index < entries.length; index++)
      await assertPage(
        await entries[index].async('uint8array'),
        index % 2 === 0 ? [200, 300] : [400, 500],
      );
  } finally {
    await page.close();
    await rm(directory, { recursive: true });
  }
}, 20000);
