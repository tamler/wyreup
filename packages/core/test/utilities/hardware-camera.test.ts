import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cameraShutterCountChecker } from '../../src/utilities/hardware.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'camera-metadata',
  onProgress() {},
});
async function run(bytes: Uint8Array, name = 'controlled.tiff') {
  const file = new File([Uint8Array.from(bytes).buffer], name, { type: '' });
  const result = await cameraShutterCountChecker.run([file], {}, context());
  const blob = Array.isArray(result) ? result[0] : result;
  expect(blob!.type).toBe('application/json');
  return JSON.parse(await blob!.text()) as Record<string, unknown>;
}
function nikon(count: number, little = false, embeddedLittle = little): Uint8Array {
  const bytes = new Uint8Array(128),
    view = new DataView(bytes.buffer);
  const header = (at: number, order: boolean) => {
    bytes.set(order ? [73, 73, 42, 0] : [77, 77, 0, 42], at);
    view.setUint32(at + 4, 8, order);
  };
  const entry = (
    at: number,
    tag: number,
    type: number,
    quantity: number,
    value: number,
    order: boolean,
  ) => {
    view.setUint16(at, tag, order);
    view.setUint16(at + 2, type, order);
    view.setUint32(at + 4, quantity, order);
    view.setUint32(at + 8, value, order);
  };
  header(0, little);
  view.setUint16(8, 1, little);
  entry(10, 0x8769, 4, 1, 26, little);
  view.setUint16(26, 1, little);
  entry(28, 0x927c, 7, 36, 44, little);
  bytes.set([78, 105, 107, 111, 110, 0, 2, 0, 0, 0], 44);
  header(54, embeddedLittle);
  view.setUint16(62, 1, embeddedLittle);
  entry(64, 0xa7, 4, 1, count, embeddedLittle);
  return bytes;
}
describe('actual bounded Nikon camera metadata tool', () => {
  it('reads4350 from original licensed D2H NEF bytes with an empty browser MIME', async () => {
    const original = await readFile(
      new URL('../fixtures/shutter-count/D2H_3957.NEF', import.meta.url),
    );
    expect(await run(original, 'D2H_3957.NEF')).toMatchObject({
      status: 'found',
      count: 4350,
      make: 'NIKON CORPORATION',
      model: 'NIKON D2H',
    });
  });
  it.each([0, 12345, 0xffffffff, 62])(
    'reads unsigned inline LONG %s, never treats count as an offset',
    async (count) => {
      for (const outer of [false, true])
        for (const embedded of [false, true])
          expect(await run(nikon(count, outer, embedded))).toMatchObject({
            status: 'found',
            count,
          });
    },
  );
  it('uses embedded IFD relative offset rather than hardcoded8', async () => {
    const bytes = nikon(12345),
      view = new DataView(bytes.buffer);
    bytes.copyWithin(70, 62, 80);
    bytes.fill(0, 62, 70);
    view.setUint32(58, 16, false);
    view.setUint32(32, 44, false);
    expect(await run(bytes)).toMatchObject({ status: 'found', count: 12345 });
  });
  it('skips leading XMP and uses the APP1-relative TIFF base', async () => {
    const tiff = nikon(12345),
      xmp = new TextEncoder().encode('XMP only'),
      exif = new Uint8Array(6 + tiff.length);
    exif.set([69, 120, 105, 102, 0, 0]);
    exif.set(tiff, 6);
    const jpeg = new Uint8Array(2 + 4 + xmp.length + 4 + exif.length + 2),
      view = new DataView(jpeg.buffer);
    jpeg.set([255, 216, 255, 225]);
    view.setUint16(4, xmp.length + 2, false);
    jpeg.set(xmp, 6);
    const next = 6 + xmp.length;
    jpeg.set([255, 225], next);
    view.setUint16(next + 2, exif.length + 2, false);
    jpeg.set(exif, next + 4);
    jpeg.set([255, 217], jpeg.length - 2);
    expect(await run(jpeg, 'controlled.jpg')).toMatchObject({ status: 'found', count: 12345 });
    await expect(run(jpeg.slice(0, -5))).rejects.toThrow(/Malformed/i);
  });
  it('distinguishes absent, unsupported and conflicting count metadata', async () => {
    const absent = nikon(1),
      av = new DataView(absent.buffer);
    av.setUint16(64, 0x1234, false);
    expect(await run(absent)).toMatchObject({ status: 'not-found' });
    expect(await run(absent)).not.toHaveProperty('count');
    const unsupported = nikon(1);
    unsupported[50] = 1;
    expect(await run(unsupported)).toMatchObject({ status: 'unsupported' });
    const duplicate = nikon(1),
      view = new DataView(duplicate.buffer);
    view.setUint32(32, 48, false);
    view.setUint16(62, 2, false);
    view.setUint16(76, 0xa7, false);
    view.setUint16(78, 4, false);
    view.setUint32(80, 1, false);
    view.setUint32(84, 2, false);
    expect(await run(duplicate)).toMatchObject({ status: 'ambiguous' });
    expect(await run(duplicate)).not.toHaveProperty('count');
  });
  it('refuses malformed followed offsets, count types, cycles and false NEF signatures', async () => {
    for (const mode of ['type', 'offset', 'cycle']) {
      const bytes = nikon(1),
        view = new DataView(bytes.buffer);
      if (mode === 'type') view.setUint16(66, 3, false);
      if (mode === 'offset') view.setUint32(36, 999999, false);
      if (mode === 'cycle') view.setUint32(76, 8, false);
      await expect(run(bytes)).rejects.toThrow(/Malformed/i);
    }
    await expect(run(new TextEncoder().encode('not a raw TIFF'), 'false.NEF')).rejects.toThrow(
      /signature/i,
    );
  });
  it('refuses followed metadata over1MiB and unknown parameters', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024);
    bytes.set(nikon(1));
    new DataView(bytes.buffer).setUint32(32, 1048577, false);
    await expect(run(bytes)).rejects.toMatchObject({ code: 'budget' });
    await expect(
      cameraShutterCountChecker.run(
        [new File([nikon(1).buffer as ArrayBuffer], 'a.nef')],
        { unknown: true },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'unknown' });
  });
});
