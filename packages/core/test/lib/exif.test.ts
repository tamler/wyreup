import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyOrientation,
  decodeJpegOrientation,
  injectJpegOrientation,
  orientImageData,
  setJpegOrientation,
} from '../../src/lib/exif.js';
import type { ExifOrientation, ImageDataLike } from '../../src/lib/exif.js';
import { getCodec } from '../../src/lib/codecs.js';
import { stripExif } from '../../src/tools/strip-exif/index.js';

type Format = 'jpeg' | 'png' | 'webp';
const formats: Format[] = ['jpeg', 'png', 'webp'];
const orientations: ExifOrientation[] = [1, 2, 3, 4, 5, 6, 7, 8];
const expectedPixels = [
  [1, 2, 3, 4, 5, 6],
  [3, 2, 1, 6, 5, 4],
  [6, 5, 4, 3, 2, 1],
  [4, 5, 6, 1, 2, 3],
  [1, 4, 2, 5, 3, 6],
  [4, 1, 5, 2, 6, 3],
  [6, 3, 5, 2, 4, 1],
  [3, 6, 2, 5, 1, 4],
];
const image: ImageDataLike = {
  width: 3,
  height: 2,
  data: Uint8ClampedArray.from([
    1, 10, 11, 12, 2, 20, 21, 22, 3, 30, 31, 32, 4, 40, 41, 42, 5, 50, 51, 52, 6, 60, 61, 62,
  ]),
};

function tight(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
function tiff(orientation = 6, little = true): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little);
  view.setUint16(12, 3, little);
  view.setUint32(14, 1, little);
  view.setUint16(18, orientation, little);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Uint8Array): Buffer {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 'ascii');
  chunk.set(payload, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function riffChunk(type: string, payload: Uint8Array): Buffer {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length % 2));
  chunk.write(type, 0, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  chunk.set(payload, 8);
  return chunk;
}

function container(format: Format, payload: Uint8Array, webpPrefix = false): ArrayBuffer {
  if (format === 'jpeg') {
    const header = Buffer.from([255, 216, 255, 225, 0, 0, 69, 120, 105, 102, 0, 0]);
    header.writeUInt16BE(payload.length + 8, 4);
    return tight(Buffer.concat([header, payload, Buffer.from([255, 217])]));
  }
  if (format === 'png')
    return tight(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('eXIf', payload),
        pngChunk('IEND', new Uint8Array()),
      ]),
    );
  const exif = webpPrefix ? Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), payload]) : payload;
  const chunks = Buffer.concat([riffChunk('JUNK', Uint8Array.of(1)), riffChunk('EXIF', exif)]);
  const header = Buffer.from('RIFF\0\0\0\0WEBP', 'ascii');
  header.writeUInt32LE(chunks.length + 4, 4);
  return tight(Buffer.concat([header, chunks]));
}

function labels(output: ImageDataLike): number[] {
  return Array.from(output.data).filter((_value, index) => index % 4 === 0);
}

describe('EXIF orientation across supported containers', () => {
  it.each(
    formats.flatMap((format) =>
      [true, false].flatMap((little) =>
        orientations.map((orientation) => ({ format, little, orientation })),
      ),
    ),
  )(
    'applies $format endian=$little orientation=$orientation with all RGBA channels intact',
    ({ format, little, orientation }) => {
      const output = orientImageData(
        container(format, tiff(orientation, little)),
        `image/${format}`,
        image,
      );
      expect(labels(output)).toEqual(expectedPixels[orientation - 1]);
      expect([output.width, output.height]).toEqual(orientation >= 5 ? [2, 3] : [3, 2]);
      for (let pixel = 0; pixel < 6; pixel++) {
        const label = output.data[pixel * 4]!;
        expect(Array.from(output.data.subarray(pixel * 4 + 1, pixel * 4 + 4))).toEqual([
          label * 10,
          label * 10 + 1,
          label * 10 + 2,
        ]);
      }
      expect(labels(image)).toEqual(expectedPixels[0]);
    },
  );

  it('accepts WebP EXIF with the existing JPEG Exif ID prefix', () => {
    expect(labels(orientImageData(container('webp', tiff(), true), 'image/webp', image))).toEqual(
      expectedPixels[5],
    );
  });

  it('keeps identity object reuse, JPEG reads/writes, and injected JPEG orientation', () => {
    expect(applyOrientation(image, 1)).toBe(image);
    for (const little of [true, false]) {
      const original = container('jpeg', tiff(6, little));
      expect(decodeJpegOrientation(original)).toBe(6);
      const rewritten = setJpegOrientation(original, 8);
      expect(rewritten).not.toBeNull();
      expect(decodeJpegOrientation(tight(rewritten!))).toBe(8);
      expect(decodeJpegOrientation(original)).toBe(6);
      expect(rewritten!.byteLength).toBe(original.byteLength);
    }
    const injected = injectJpegOrientation(tight(Uint8Array.of(255, 216, 255, 217)), 6);
    expect(decodeJpegOrientation(tight(injected!))).toBe(6);
  });

  it.each(formats)(
    'ignores malformed $format TIFF type/count/offset/value instead of reading adjacent bytes',
    (format) => {
      const cases: Uint8Array[] = [];
      for (const [offset, value, wide] of [
        [12, 4, 2],
        [14, 2, 4],
        [4, 2, 4],
        [4, 0xffffffff, 4],
        [8, 0xffff, 2],
        [18, 0, 2],
        [18, 9, 2],
      ] as const) {
        const bytes = tiff();
        const view = new DataView(bytes.buffer);
        if (wide === 2) view.setUint16(offset, value, true);
        else view.setUint32(offset, value, true);
        cases.push(bytes);
      }
      cases.push(tiff().subarray(0, 7), tiff().subarray(0, 22));
      for (const bytes of cases) {
        expect(() =>
          orientImageData(container(format, bytes), `image/${format}`, image),
        ).not.toThrow();
        expect(orientImageData(container(format, bytes), `image/${format}`, image)).toBe(image);
        if (format === 'jpeg') expect(setJpegOrientation(container(format, bytes), 6)).toBeNull();
      }
    },
  );

  it('honors JPEG segment, PNG chunk, and RIFF boundaries and odd padding', () => {
    const jpeg = new Uint8Array(container('jpeg', tiff()));
    new DataView(jpeg.buffer).setUint16(4, 8);
    expect(decodeJpegOrientation(jpeg.buffer)).toBe(1);
    expect(setJpegOrientation(jpeg.buffer, 8)).toBeNull();
    const png = new Uint8Array(container('png', tiff()));
    new DataView(png.buffer).setUint32(8, 0xffffffff);
    expect(orientImageData(png.buffer, 'image/png', image)).toBe(image);
    const webp = new Uint8Array(container('webp', tiff()));
    new DataView(webp.buffer).setUint32(4, 4, true);
    expect(orientImageData(webp.buffer, 'image/webp', image)).toBe(image);
    const missingPad = new Uint8Array(container('webp', tiff()));
    missingPad[21] = 9;
    expect(orientImageData(missingPad.buffer, 'image/webp', image)).toBe(image);
  });

  it('skips non-EXIF JPEG APP1 without inspecting encoded image data after SOS', () => {
    const original = new Uint8Array(container('jpeg', tiff()));
    const before = Buffer.from([255, 216, 255, 225, 0, 5, 88, 77, 80]);
    const withXmp = tight(Buffer.concat([before, original.subarray(2)]));
    expect(decodeJpegOrientation(withXmp)).toBe(6);
    const afterSos = tight(
      Buffer.concat([Buffer.from([255, 216, 255, 218, 0, 2]), original.subarray(2)]),
    );
    expect(decodeJpegOrientation(afterSos)).toBe(1);
  });

  it('rejects JPEG segment lengths zero/one and unsupported lengthless markers without throwing', () => {
    for (const length of [0, 1]) {
      const malformed = tight(
        Buffer.concat([Buffer.from([255, 216, 255, 225, 0, length]), tiff()]),
      );
      expect(decodeJpegOrientation(malformed)).toBe(1);
      expect(setJpegOrientation(malformed, 8)).toBeNull();
    }
    for (const code of [0, 1, 0xd0, 0xd7, 0xd8, 0xd9]) {
      const malformed = tight(
        Buffer.concat([
          Buffer.from([255, 216, 255, code]),
          new Uint8Array(container('jpeg', tiff())).subarray(2),
        ]),
      );
      expect(decodeJpegOrientation(malformed)).toBe(1);
      expect(setJpegOrientation(malformed, 8)).toBeNull();
    }
    for (const bytes of [
      Uint8Array.of(255, 216, 255),
      Uint8Array.of(255, 216, 255, 255, 255),
      Uint8Array.of(255, 216, 255, 225, 0),
    ]) {
      expect(decodeJpegOrientation(tight(bytes))).toBe(1);
      expect(setJpegOrientation(tight(bytes), 8)).toBeNull();
    }
  });

  it('supports valid JPEG marker fill and the image/jpg alias', () => {
    const original = new Uint8Array(container('jpeg', tiff()));
    const filled = tight(Buffer.concat([Buffer.from([255, 216, 255, 255]), original.subarray(2)]));
    expect(decodeJpegOrientation(filled)).toBe(6);
    expect(labels(orientImageData(filled, 'image/jpg', image))).toEqual(expectedPixels[5]);
    const rewritten = setJpegOrientation(filled, 8);
    expect(decodeJpegOrientation(tight(rewritten!))).toBe(8);
  });
});

describe('metadata stripping preserves displayed orientation in actual codecs', () => {
  it.each(formats)(
    'bakes orientation6 $format dimensions and four color quadrants, then drops EXIF',
    async (format) => {
      const extension = format === 'jpeg' ? 'jpg' : format;
      const source = readFileSync(
        new URL(`../fixtures/orientation6-metadata.${extension}`, import.meta.url),
      );
      const before = createHash('sha256').update(source).digest('hex');
      const result = await stripExif.run(
        [new File([tight(source)], 'orientation-test', { type: `image/${format}` })],
        {},
        {
          signal: new AbortController().signal,
          cache: new Map(),
          executionId: 'orientation-regression',
          onProgress: () => {},
        },
      );
      const output = Array.isArray(result) ? result[0]! : result;
      const bytes = await output.arrayBuffer();
      const decoded = await (await getCodec(format)).decode(bytes);
      expect([decoded.width, decoded.height]).toEqual([80, 120]);
      const expected = [
        [20, 20, 230],
        [230, 20, 20],
        [230, 210, 20],
        [20, 210, 20],
      ];
      const points = [
        [20, 30],
        [60, 30],
        [20, 90],
        [60, 90],
      ];
      points.forEach(([x, y], index) => {
        const offset = (y! * decoded.width + x!) * 4;
        for (let channel = 0; channel < 3; channel++)
          expect(
            Math.abs(decoded.data[offset + channel]! - expected[index]![channel]!),
          ).toBeLessThanOrEqual(35);
      });
      const encoded = Buffer.from(bytes);
      expect(
        encoded.includes(
          Buffer.from(format === 'png' ? 'eXIf' : format === 'webp' ? 'EXIF' : 'Exif\0\0'),
        ),
      ).toBe(false);
      expect(createHash('sha256').update(source).digest('hex')).toBe(before);
    },
  );
});
