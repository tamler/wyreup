import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted PSD saved-composite conversion through an actual browser worker', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PsdHarness.svelte', { fileWorker: true }); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('imports a real PSD, previews full-resolution pixels and reopens the downloaded PNG', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(harness.url);
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
      await (await chooser).setFiles({ name: 'original.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: await readFile(new URL('../../core/test/fixtures/catalog-composite.psd', import.meta.url)) });
      await page.getByRole('button', { name: 'Convert PSD to PNG', exact: true }).click();
      await page.getByRole('link', { name: 'Download PNG', exact: true }).waitFor();
      const pixels = await page.getByRole('img', { name: 'Converted saved PSD composite' }).evaluate(async element => {
        const image = element as HTMLImageElement; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0); return { width: canvas.width, height: canvas.height, pixels: [...context.getImageData(0, 0, 2, 2).data] };
      });
      expect(pixels).toEqual({ width: 2, height: 2, pixels: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255] });
      const downloaded = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download PNG', exact: true }).click();
      const path = await (await downloaded).path(); if (!path) throw new Error('PNG download missing');
      const bytes = [...await readFile(path)]; expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const reopened = await page.evaluate(async values => {
        const blob = new Blob([new Uint8Array(values)], { type: 'image/png' });
        const image = await createImageBitmap(blob); const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0); const pixels = [...context.getImageData(0, 0, 2, 2).data]; image.close(); return pixels;
      }, bytes);
      expect(reopened).toEqual(pixels.pixels);
      await page.getByRole('button', { name: 'Unmount PSD converter', exact: true }).click();
      expect(await page.getByRole('link', { name: 'Download PNG', exact: true }).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
});
