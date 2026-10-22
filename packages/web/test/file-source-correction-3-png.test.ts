import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodePngOracle, originalPsd } from '../../core/test/helpers/file3-png-oracle';
import { openBrowserHarness } from './browserHarness';

const explicit = [200, 100, 50, 1, 17, 83, 201, 128, 200, 100, 50, 0, 11, 99, 201, 255];
const planes = [
  [200, 17, 200, 11],
  [100, 83, 100, 99],
  [50, 201, 50, 201],
  [1, 128, 0, 255],
];
const mergedPlanes = [
  [255, 136, 200, 11],
  [255, 169, 100, 99],
  [255, 228, 50, 201],
  [1, 128, 0, 255],
];
const merged = [255, 255, 255, 1, 18, 84, 201, 128, 200, 100, 50, 0, 11, 99, 201, 255];

describe('FILE3 actual mounted PSD worker downloads independently decoded straight PNG', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/PsdHarness.svelte', { fileWorker: true });
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it.each([
    ['explicit raw', originalPsd(planes, false), 'channel-as-transparency', explicit],
    ['explicit RLE', originalPsd(planes, true), 'channel-as-transparency', explicit],
    ['merged raw', originalPsd(mergedPlanes, false, true), 'auto', merged],
    ['merged RLE', originalPsd(mergedPlanes, true, true), 'auto', merged],
    [
      'auxiliary opaque',
      originalPsd(planes, false),
      'auto',
      explicit.map((v, i) => (i % 4 === 3 ? 255 : v)),
    ],
    [
      'grayscale RLE',
      originalPsd(
        [
          [200, 17, 200, 11],
          [1, 128, 0, 255],
        ],
        true,
        false,
        true,
      ),
      'channel-as-transparency',
      [200, 200, 200, 1, 17, 17, 17, 128, 200, 200, 200, 0, 11, 11, 11, 255],
    ],
  ] as const)(
    'saves exact noncanvas RGBA for %s',
    async (_label, source, mode, expected) => {
      const page = await harness.browser.newPage({ viewport: { width: 375, height: 812 } });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      const requests: string[] = [];
      const wasm: Array<{ type: string; status: number }> = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => requests.push(request.url()));
      page.on('response', (response) => {
        if (response.url() === harness.url + '/squoosh_png_bg.wasm')
          wasm.push({
            type: response.headers()['content-type'] ?? '',
            status: response.status(),
          });
      });
      try {
        await page.goto(harness.url);
        const chooser = page.waitForEvent('filechooser');
        await page
          .getByRole('button', { name: 'Drop file or click to browse', exact: true })
          .click();
        await (
          await chooser
        ).setFiles({
          name: 'original.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          buffer: Buffer.from(source),
        });
        await page.getByLabel('Transparency', { exact: true }).selectOption({
          label:
            mode === 'auto'
              ? 'Use saved merged transparency; auxiliary masks stay opaque'
              : 'Treat the extra channel as transparency',
        });
        await page.getByRole('button', { name: 'Convert PSD to PNG', exact: true }).click();
        const downloadLink = page.getByRole('link', { name: 'Download PNG', exact: true });
        await downloadLink.waitFor();
        const downloading = page.waitForEvent('download');
        await downloadLink.click();
        const path = await (await downloading).path();
        if (!path) throw new Error('Actual PNG download missing.');
        const decoded = decodePngOracle(new Uint8Array(await readFile(path)));
        expect([decoded.width, decoded.height, decoded.bitDepth]).toEqual([2, 2, 8]);
        expect([...decoded.rgba]).toEqual(expected);
        expect(wasm.length).toBeGreaterThanOrEqual(1);
        expect(wasm.length).toBeLessThanOrEqual(2);
        for (const asset of wasm) expect(asset).toEqual({ type: 'application/wasm', status: 200 });
        // The owned worker is already terminated after completion; inspect the same served asset
        // independently rather than asking DevTools for a body from that closed worker target.
        const response = await fetch(harness.url + '/squoosh_png_bg.wasm');
        const asset = new Uint8Array(await response.arrayBuffer());
        expect(response.headers.get('content-type')).toBe('application/wasm');
        expect(asset.length).toBe(181088);
        expect(createHash('sha256').update(asset).digest('hex')).toBe(
          '263d6e658808a74b72a1a99c5cc1d619237e70c150db6e41d5d84d3d117ab9be',
        );
        expect(
          requests.every(
            (url) =>
              url.startsWith(harness.url + '/') || url.startsWith('blob:' + harness.url + '/'),
          ),
        ).toBe(true);
        expect(requests.some((url) => /node:|node%3A/.test(url))).toBe(false);
        expect(errors).toEqual([]);
        await page.getByRole('button', { name: 'Unmount PSD converter', exact: true }).click();
        expect(await downloadLink.count()).toBe(0);
      } catch (reason) {
        console.error(
          JSON.stringify({ errors, requests, body: await page.locator('body').innerText() }),
        );
        throw reason;
      } finally {
        await page.close();
      }
    },
    30000,
  );
});
