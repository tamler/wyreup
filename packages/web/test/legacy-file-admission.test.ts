import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { openLegacyFileAdmissionHarness } from './legacyFileAdmissionHarness';

interface Probe {
  events: { status: string; original: boolean; current: boolean }[];
  reads: number;
  completedReads: number;
  releaseRead(): void;
}
let harness: Awaited<ReturnType<typeof openLegacyFileAdmissionHarness>>;
beforeAll(async () => {
  harness = await openLegacyFileAdmissionHarness();
}, 30000);
afterAll(async () => {
  await harness?.close();
});
async function inputFor(id: string) {
  if (id === 'hash' || id === 'base64')
    return {
      bytes: [...new TextEncoder().encode('abc')],
      name: 'original.txt',
      mime: 'text/plain',
    };
  if (id === 'zip-info') {
    const zip = new JSZip();
    zip.file('original.txt', 'Original contents');
    return {
      bytes: [...(await zip.generateAsync({ type: 'uint8array' }))],
      name: 'original.zip',
      mime: 'application/zip',
    };
  }
  if (id === 'excel-info') {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    );
    zip.file(
      'xl/workbook.xml',
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Original sheet" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Alpha</t></is></c><c r="B1"><v>7</v></c></row></sheetData></worksheet>',
    );
    return {
      bytes: [...(await zip.generateAsync({ type: 'uint8array' }))],
      name: 'original.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  if (id.startsWith('pdf-') || id === 'split-pdf')
    return {
      bytes: [...(await readFile(new URL('../../core/test/fixtures/doc-a.pdf', import.meta.url)))],
      name: 'original.pdf',
      mime: 'application/pdf',
    };
  return {
    bytes: [...(await readFile(new URL('../../core/test/fixtures/graphic.png', import.meta.url)))],
    name: 'original.png',
    mime: 'image/png',
  };
}
async function pageFor(id: string, extras: { delayedRead?: boolean; failRead?: boolean } = {}) {
  const page = await harness.browser.newPage({ acceptDownloads: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === harness.url ? route.continue() : route.abort(),
  );
  await page.addInitScript(
    (raw) => {
      Object.assign(window, { legacyAdmissionInput: raw });
    },
    { ...(await inputFor(id)), ...extras },
  );
  try {
    await page.goto(`${harness.url}?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 3000 });
    await page.getByRole('button', { name: 'Unmount legacy runner' }).waitFor({ timeout: 1500 });
  } catch (error) {
    await page.close();
    throw new Error(`Actual package fixture failed to mount: ${pageErrors.join('; ')}`, {
      cause: error,
    });
  }
  return page;
}
const tools = [
  { id: 'grayscale', run: 'Run Grayscale', done: 'Run Grayscale again' },
  { id: 'split-pdf', run: 'Run Split PDF', done: 'Run Split PDF again' },
  { id: 'base64', run: 'Run Base64', done: 'Run Base64 again' },
  { id: 'color-palette', run: 'Extract palette', done: 'Extract again' },
  { id: 'hash', run: 'Hash file', done: 'Hash again' },
  { id: 'image-info', run: 'Inspect image', done: 'Inspect again' },
  { id: 'pdf-info', run: 'Inspect PDF', done: 'Inspect again' },
  { id: 'pdf-metadata', run: 'Run', done: 'Download JSON' },
  { id: 'qr-reader', run: 'Decode QR', done: 'Decode again' },
  { id: 'zip-info', run: 'Run ZIP Info', done: 'Run ZIP Info again' },
  { id: 'excel-info', run: 'Run Excel Info', done: 'Run Excel Info again' },
];
describe('actual browser package legacy runner admission', () => {
  it('mounts the real default registry hash producer and verifies its independent digest', async () => {
    console.log('legacy hash smoke: opening actual-package fixture');
    const page = await pageFor('hash');
    try {
      console.log('legacy hash smoke: fixture mounted');
      await page.getByRole('button', { name: 'Hash file', exact: true }).click({ timeout: 1500 });
      console.log('legacy hash smoke: actual producer gesture delivered');
      await page
        .getByRole('button', { name: 'Hash again', exact: true })
        .waitFor({ timeout: 1500 });
      console.log('legacy hash smoke: actual producer result committed');
      expect(
        await page
          .getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', {
            exact: true,
          })
          .count(),
      ).toBe(1);
    } finally {
      await page.close();
    }
  }, 15000);
  it.each(tools)(
    'admits $id only after its actual explicit result is ready',
    async ({ id, run, done }) => {
      const page = await pageFor(id);
      try {
        expect(
          await page.evaluate(
            () => (window as unknown as { legacyAdmission: Probe }).legacyAdmission.events,
          ),
        ).toEqual([]);
        await page.getByRole('button', { name: run, exact: true }).click({ timeout: 1500 });
        await page.getByRole('button', { name: done, exact: true }).waitFor({ timeout: 4000 });
        await expect
          .poll(
            () =>
              page.evaluate(
                () => (window as unknown as { legacyAdmission: Probe }).legacyAdmission.events,
              ),
            { timeout: 1000 },
          )
          .toEqual([{ status: 'admitted', original: true, current: true }]);
        if (id === 'hash')
          expect(
            await page
              .getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', {
                exact: true,
              })
              .count(),
          ).toBe(1);
        if (id === 'base64') {
          expect(await page.getByLabel('Text result', { exact: true }).textContent()).toBe('YWJj');
          const downloading = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Download', exact: true }).click();
          const path = await (await downloading).path();
          if (!path) throw new Error('Actual Base64 artifact download is missing.');
          expect(await readFile(path)).toEqual(Buffer.from('YWJj', 'utf8'));
        }
        if (id === 'zip-info')
          expect(await page.getByText('original.txt', { exact: true }).count()).toBeGreaterThan(0);
        if (id === 'excel-info')
          expect(await page.getByText('Alpha', { exact: true }).count()).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
    15000,
  );
  it('never admits a failed actual hash File read', async () => {
    const page = await pageFor('hash', { failRead: true });
    try {
      await page.getByRole('button', { name: 'Hash file', exact: true }).click({ timeout: 1500 });
      await page.getByText('Controlled actual File read rejection.', { exact: true }).waitFor();
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { legacyAdmission: Probe }).legacyAdmission.events,
            ),
          { timeout: 1000 },
        )
        .toEqual([{ status: 'refused', original: true, current: true }]);
    } finally {
      await page.close();
    }
  }, 15000);
  it('does not admit or render a late actual hash result after unmount', async () => {
    const page = await pageFor('hash', { delayedRead: true });
    try {
      await page.getByRole('button', { name: 'Hash file', exact: true }).click({ timeout: 1500 });
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { legacyAdmission: Probe }).legacyAdmission.reads,
            ),
          { timeout: 1000 },
        )
        .toBe(1);
      await page.getByRole('button', { name: 'Unmount legacy runner' }).click();
      await page.evaluate(() =>
        (window as unknown as { legacyAdmission: Probe }).legacyAdmission.releaseRead(),
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as unknown as { legacyAdmission: Probe }).legacyAdmission.completedReads,
            ),
          { timeout: 1000 },
        )
        .toBe(1);
      expect(
        await page.evaluate(
          () => (window as unknown as { legacyAdmission: Probe }).legacyAdmission.events,
        ),
      ).toEqual([]);
      expect(
        await page
          .getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', {
            exact: true,
          })
          .count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  }, 15000);
  it('does not call the image-similarity producer with only one staged image', async () => {
    const page = await pageFor('image-similarity');
    try {
      expect(
        await page.getByRole('button', { name: 'Compare images', exact: true }).isDisabled(),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { legacyAdmission: Probe }).legacyAdmission.events,
        ),
      ).toEqual([]);
    } finally {
      await page.close();
    }
  }, 15000);
});
