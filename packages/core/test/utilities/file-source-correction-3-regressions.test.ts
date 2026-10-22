import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { rgbaToPng } from '../../src/lib/canvas.js';
import { readPsdComposite } from '../../src/utilities/psd-composite.js';
import { decodePngOracle, originalPng, originalPsd, pngCrc } from '../helpers/file3-png-oracle.js';

const expected = [200, 100, 50, 1, 17, 83, 201, 128, 200, 100, 50, 0, 11, 99, 201, 255];
const planes = [
  [200, 17, 200, 11],
  [100, 83, 100, 99],
  [50, 201, 50, 201],
  [1, 128, 0, 255],
];
async function pixels(data: Uint8ClampedArray) {
  const blob = await rgbaToPng(2, 2, data);
  expect(blob.type).toBe('image/png');
  const decoded = decodePngOracle(new Uint8Array(await blob.arrayBuffer()));
  expect([decoded.width, decoded.height, decoded.bitDepth]).toEqual([2, 2, 8]);
  return [...decoded.rgba];
}

describe('independent PNG oracle controls', () => {
  it('matches the standard CRC known answer', () => {
    expect(pngCrc(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it.each([
    [0, [10, 20, 30, 40, 50, 60, 70, 80], [90, 100, 110, 120, 130, 140, 150, 160]],
    [1, [10, 20, 30, 40, 40, 40, 40, 40], [90, 100, 110, 120, 40, 40, 40, 40]],
    [2, [10, 20, 30, 40, 50, 60, 70, 80], [80, 80, 80, 80, 80, 80, 80, 80]],
    [3, [10, 20, 30, 40, 45, 50, 55, 60], [85, 90, 95, 100, 60, 60, 60, 60]],
    [4, [10, 20, 30, 40, 40, 40, 40, 40], [80, 80, 80, 80, 40, 40, 40, 40]],
  ] as const)('decodes manually specified filter %i rows', (filter, first, second) => {
    const png = originalPng(2, 2, 6, [filter, ...first, filter, ...second]);
    expect([...decodePngOracle(png).rgba]).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
    ]);
  });
  it.each([
    [0, [9, 50], [9, 9, 9, 255, 50, 50, 50, 255]],
    [2, [9, 10, 11, 50, 51, 52], [9, 10, 11, 255, 50, 51, 52, 255]],
    [4, [9, 0, 50, 128], [9, 9, 9, 0, 50, 50, 50, 128]],
  ] as const)('decodes supported direct samples of color type %i', (type, samples, rgba) => {
    expect([...decodePngOracle(originalPng(2, 1, type, [0, ...samples])).rgba]).toEqual(rgba);
  });
  it('refuses corrupted CRC, truncation, unexpected inflated length and unsupported type', () => {
    const png = originalPng(2, 1, 6, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const corrupt = new Uint8Array(png);
    corrupt[29] = corrupt[29]! ^ 1;
    expect(() => decodePngOracle(corrupt)).toThrow(/CRC/);
    expect(() => decodePngOracle(png.subarray(0, png.length - 1))).toThrow();
    expect(() => decodePngOracle(originalPng(2, 1, 6, [0, 1]))).toThrow(/bounds/);
    expect(() => decodePngOracle(originalPng(1, 1, 3, [0, 1]))).toThrow(/header/);
  });
});

describe('FILE3 exact nonpremultiplied saved PNG samples', () => {
  it.each([false, true])(
    'preserves explicit alpha0/1/128/255 from original PSD, RLE=%s',
    async (rle) => {
      const composite = readPsdComposite(originalPsd(planes, rle), 'channel-as-transparency');
      expect(composite.alphaSource).toBe('explicit-channel');
      expect([...composite.rgba]).toEqual(expected);
      expect(await pixels(composite.rgba)).toEqual(expected);
    },
  );
  it.each([false, true])(
    'preserves independently calculated merged alpha samples once, RLE=%s',
    async (rle) => {
      const composite = readPsdComposite(
        originalPsd(
          [
            [255, 136, 200, 11],
            [255, 169, 100, 99],
            [255, 228, 50, 201],
            [1, 128, 0, 255],
          ],
          rle,
          true,
        ),
      );
      const merged = [255, 255, 255, 1, 18, 84, 201, 128, 200, 100, 50, 0, 11, 99, 201, 255];
      expect(composite.alphaSource).toBe('merged-transparency');
      expect([...composite.rgba]).toEqual(merged);
      expect(await pixels(composite.rgba)).toEqual(merged);
    },
  );
  it.each([false, true])('retains nonzero RGB for a fully transparent PSD, RLE=%s', async (rle) => {
    const transparent = [200, 100, 50, 0, 17, 83, 201, 0, 200, 100, 50, 0, 11, 99, 201, 0];
    const composite = readPsdComposite(
      originalPsd([...planes.slice(0, 3), [0, 0, 0, 0]], rle),
      'channel-as-transparency',
    );
    expect([...composite.rgba]).toEqual(transparent);
    expect(await pixels(composite.rgba)).toEqual(transparent);
  });
  it.each([false, true])('preserves explicit grayscale alpha exactly, RLE=%s', async (rle) => {
    const gray = [200, 200, 200, 1, 17, 17, 17, 128, 200, 200, 200, 0, 11, 11, 11, 255];
    const composite = readPsdComposite(
      originalPsd(
        [
          [200, 17, 200, 11],
          [1, 128, 0, 255],
        ],
        rle,
        false,
        true,
      ),
      'channel-as-transparency',
    );
    expect([...composite.rgba]).toEqual(gray);
    expect(await pixels(composite.rgba)).toEqual(gray);
  });
  it('keeps an unmarked extra channel opaque in auto mode', async () => {
    const composite = readPsdComposite(originalPsd(planes, false));
    const opaque = expected.map((value, index) => (index % 4 === 3 ? 255 : value));
    expect(composite.alphaSource).toBe('opaque');
    expect([...composite.rgba]).toEqual(opaque);
    expect(await pixels(composite.rgba)).toEqual(opaque);
  });
  it('normalizes a subview without encoding or altering parent sentinels', async () => {
    const parent = new Uint8ClampedArray(expected.length + 2);
    parent[0] = 165;
    parent[parent.length - 1] = 90;
    parent.set(expected, 1);
    const before = [...parent];
    expect(await pixels(parent.subarray(1, parent.length - 1))).toEqual(expected);
    expect([...parent]).toEqual(before);
  });
  it('rejects shared and resizable input and survives an aborted call', async () => {
    const shared = new Uint8ClampedArray(new SharedArrayBuffer(16));
    await expect(rgbaToPng(2, 2, shared)).rejects.toThrow();
    const buffer: unknown = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 32 }]);
    if (!(buffer instanceof ArrayBuffer)) throw new Error('Native resizable buffer unavailable.');
    const resizable = new Uint8ClampedArray(buffer);
    await expect(rgbaToPng(2, 2, resizable)).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      rgbaToPng(2, 2, new Uint8ClampedArray(expected), controller.signal),
    ).rejects.toThrow(/cancel/);
  });
  it('refuses an input detached during an asynchronous load boundary', async () => {
    const input = new Uint8ClampedArray(expected);
    const pending = rgbaToPng(2, 2, input);
    structuredClone(input.buffer, { transfer: [input.buffer] });
    await expect(pending).rejects.toThrow();
  });
});

describe('FILE3 exact consumer dependency declarations', () => {
  it('pins the PDF API/worker and investigated PNG codec versions', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect.soft(manifest.dependencies['pdfjs-dist']).toBe('6.4.299');
    expect(manifest.dependencies['@jsquash/png']).toBe('3.1.1');
  });
});
