import { describe, expect, it } from 'vitest';
import { canonicalCompositePsd, readPsdComposite } from '../../src/utilities/psd-composite.js';

interface FixtureOptions { width?: number; height?: number; gray?: boolean; merged?: boolean; rle?: boolean }
function fixture(planes: number[][], options: FixtureOptions = {}): Uint8Array {
  const width = options.width ?? 2, height = options.height ?? 2;
  const layer = options.merged ? new Uint8Array(56) : new Uint8Array();
  if (options.merged) {
    const l = new DataView(layer.buffer);
    l.setUint32(0, 48); l.setInt16(4, -1);
    layer.set([0x38, 0x42, 0x49, 0x4d, 0x6e, 0x6f, 0x72, 0x6d], 24);
    layer[32] = 255; l.setUint32(36, 12);
  }
  const lengths: number[] = [];
  const encoded: number[] = [];
  for (const plane of planes) for (let row = 0; row < height; row++) {
    const values = plane.slice(row * width, (row + 1) * width);
    if (options.rle) { lengths.push(values.length + 1); encoded.push(values.length - 1, ...values); }
    else encoded.push(...values);
  }
  const countBytes = options.rle ? planes.length * height * 2 : 0;
  const bytes = new Uint8Array(40 + layer.length + countBytes + encoded.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53]); view.setUint16(4, 1);
  view.setUint16(12, planes.length); view.setUint32(14, height); view.setUint32(18, width);
  view.setUint16(22, 8); view.setUint16(24, options.gray ? 1 : 3);
  view.setUint32(34, layer.length); bytes.set(layer, 38);
  let offset = 38 + layer.length; view.setUint16(offset, options.rle ? 1 : 0); offset += 2;
  for (const length of lengths) { view.setUint16(offset, length); offset += 2; }
  bytes.set(encoded, offset);
  return bytes;
}

describe('strict PSD saved-composite reader', () => {
  it('reads independently encoded full-resolution raw and RLE RGB pixels', () => {
    const planes = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    const expected = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
    for (const rle of [false, true]) {
      const result = readPsdComposite(fixture(planes, { rle }));
      expect([result.width, result.height]).toEqual([2, 2]);
      expect([...result.rgba]).toEqual(expected);
      expect(result.alphaSource).toBe('opaque');
      expect([...readPsdComposite(canonicalCompositePsd(result), 'channel-as-transparency').rgba]).toEqual(expected);
    }
  });

  it('treats an unmarked extra channel as auxiliary unless explicitly selected', () => {
    const bytes = fixture([[255, 0, 50, 20], [0, 255, 60, 30], [0, 0, 70, 40], [0, 128, 255, 0]]);
    const auto = readPsdComposite(bytes);
    expect([...auto.rgba].filter((_value, index) => index % 4 === 3)).toEqual([255, 255, 255, 255]);
    const explicit = readPsdComposite(bytes, 'channel-as-transparency');
    expect(explicit.alphaSource).toBe('explicit-channel');
    expect([...explicit.rgba]).toEqual([255, 0, 0, 0, 0, 255, 0, 128, 50, 60, 70, 255, 20, 30, 40, 0]);
  });

  it('uses negative layer count for merged transparency and removes white matte exactly once', () => {
    const result = readPsdComposite(fixture([[255, 127, 50, 20], [0, 255, 60, 30], [0, 127, 70, 40], [0, 128, 255, 0]], { merged: true }));
    expect(result.alphaSource).toBe('merged-transparency');
    expect([...result.rgba]).toEqual([255, 0, 0, 0, 0, 255, 0, 128, 50, 60, 70, 255, 20, 30, 40, 0]);
    const canonical = readPsdComposite(canonicalCompositePsd(result), 'channel-as-transparency');
    expect([...canonical.rgba]).toEqual([...result.rgba]);
  });

  it('preserves grayscale and full transparency rather than falling back to a thumbnail', () => {
    expect([...readPsdComposite(fixture([[0, 64, 128, 255]], { gray: true })).rgba]).toEqual([0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    expect([...readPsdComposite(fixture([[0, 64, 128, 255], [0, 0, 0, 0]], { gray: true, rle: true }), 'channel-as-transparency').rgba]).toEqual([0, 0, 0, 0, 64, 64, 64, 0, 128, 128, 128, 0, 255, 255, 255, 0]);
  });

  it('decodes PackBits repeats and no-ops with exact row consumption', () => {
    const raw = fixture([[9], [9], [9]], { width: 1, height: 1, rle: true });
    const bytes = new Uint8Array(40 + 6 + 9);
    bytes.set(raw.subarray(0, 40));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 3; i++) { view.setUint16(40 + i * 2, 3); bytes.set([128, 0, 9], 46 + i * 3); }
    expect([...readPsdComposite(bytes).rgba]).toEqual([9, 9, 9, 255]);
    for (let i = 0; i < 3; i++) { view.setUint16(40 + i * 2, 3); bytes.set([128, 255, 9], 46 + i * 3); }
    expect(() => readPsdComposite(bytes)).toThrow(/width/);
    const repeat = new Uint8Array(40 + 6 + 6);
    repeat.set(fixture([[0, 0], [0, 0], [0, 0]], { width: 2, height: 1, rle: true }).subarray(0, 40));
    const r = new DataView(repeat.buffer);
    for (let i = 0; i < 3; i++) { r.setUint16(40 + i * 2, 2); repeat.set([255, 9], 46 + i * 2); }
    expect([...readPsdComposite(repeat).rgba]).toEqual([9, 9, 9, 255, 9, 9, 9, 255]);
  });

  it('rejects invalid header, allocation budgets, sections, missing composite and compression before decode', () => {
    const original = fixture([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
    for (const modify of [
      (v: DataView) => v.setUint16(4, 2),
      (v: DataView) => v.setUint8(6, 1),
      (v: DataView) => v.setUint16(22, 16),
      (v: DataView) => v.setUint16(24, 4),
      (v: DataView) => v.setUint32(18, 8193),
      (v: DataView) => { v.setUint32(18, 8192); v.setUint32(14, 8192); },
      (v: DataView) => v.setUint32(30, 0xffffffff),
      (v: DataView) => v.setUint16(38, 2),
      (v: DataView) => v.setUint16(38, 3),
    ]) { const bytes = new Uint8Array(original); modify(new DataView(bytes.buffer)); expect(() => readPsdComposite(bytes)).toThrow(); }
    expect(() => readPsdComposite(original.subarray(0, original.length - 1))).toThrow(/Truncated|missing/);
    const trailing = new Uint8Array(original.length + 1); trailing.set(original);
    expect(() => readPsdComposite(trailing)).toThrow(/trailing/);
    const controller = new AbortController(); controller.abort();
    expect(() => readPsdComposite(original, 'auto', controller.signal)).toThrow(/cancelled/);
  });

  it('rejects truncated, underfilled and overflowing RLE rows without a partial image', () => {
    const original = fixture([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]], { rle: true });
    const overflow = new Uint8Array(original); overflow[52] = 127;
    expect(() => readPsdComposite(overflow)).toThrow(/width/);
    const under = new Uint8Array(original); under[52] = 128;
    expect(() => readPsdComposite(under)).toThrow();
    expect(() => readPsdComposite(original.subarray(0, original.length - 1))).toThrow(/Truncated/);
    const missing = fixture([[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]], { merged: true });
    expect(() => readPsdComposite(missing)).toThrow(/extra channel/);
  });
});
