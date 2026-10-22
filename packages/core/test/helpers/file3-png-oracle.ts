import { deflateSync, inflateSync } from 'node:zlib';

export function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(bytes.length - 4, pngCrc(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}

/** Original test-only PNG assembler; caller supplies independently known filtered rows. */
export function originalPng(
  width: number,
  height: number,
  colorType: number,
  rows: number[],
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(new Uint8Array(rows))),
    chunk('IEND', new Uint8Array()),
  ];
  const bytes = new Uint8Array(8 + chunks.reduce((sum, part) => sum + part.length, 0));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** Bounded independent 8-bit, noninterlaced sample decoder; never uses canvas/jSquash. */
export function decodePngOracle(bytes: Uint8Array): {
  width: number;
  height: number;
  bitDepth: number;
  rgba: Uint8Array;
} {
  if (
    bytes.length < 45 ||
    bytes.length > 96 * 1024 * 1024 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    throw new Error('PNG signature/budget');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    colorType = -1,
    ended = false,
    idatEnded = false;
  const compressed: Uint8Array[] = [];
  while (offset < bytes.length) {
    if (ended || offset + 12 > bytes.length) throw new Error('PNG trailing/truncated chunk');
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) throw new Error('PNG chunk bounds');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      view.getUint32(offset + 8 + length) !==
      pngCrc(bytes.subarray(offset + 4, offset + 8 + length))
    )
      throw new Error('PNG CRC');
    if (offset === 8 && type !== 'IHDR') throw new Error('PNG first chunk');
    if (type === 'IHDR') {
      if (width || length !== 13) throw new Error('PNG IHDR');
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      colorType = data[9]!;
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType] ?? 0;
      if (
        !width ||
        !height ||
        width > 8192 ||
        height > 8192 ||
        width * height > 16000000 ||
        data[8] !== 8 ||
        !channels ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw new Error('PNG unsupported header');
    } else if (type === 'IDAT') {
      if (!width || idatEnded) throw new Error('PNG IDAT order');
      compressed.push(data);
    } else {
      if (compressed.length) idatEnded = true;
      if (type === 'IEND') {
        if (length || !compressed.length) throw new Error('PNG IEND');
        ended = true;
      } else if (type === 'tRNS' || (type.charCodeAt(0) & 32) === 0)
        throw new Error('PNG unsupported chunk');
    }
    offset += length + 12;
  }
  if (!ended) throw new Error('PNG missing IEND');
  const stride = width * channels;
  const expected = height * (stride + 1);
  const packed = Buffer.concat(compressed);
  const filtered = inflateSync(packed, { maxOutputLength: expected });
  if (filtered.length !== expected) throw new Error('PNG inflated bounds');
  const raw = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]!;
    if (filter > 4) throw new Error('PNG unsupported filter');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= channels ? raw[index - channels]! : 0;
      const above = y ? raw[index - stride]! : 0;
      const corner = y && x >= channels ? raw[index - stride - channels]! : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = above;
      else if (filter === 3) prediction = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const target = left + above - corner;
        const a = Math.abs(target - left),
          b = Math.abs(target - above),
          c = Math.abs(target - corner);
        prediction = a <= b && a <= c ? left : b <= c ? above : corner;
      }
      raw[index] = (filtered[y * (stride + 1) + x + 1]! + prediction) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * channels,
      target = pixel * 4;
    if (colorType === 0 || colorType === 4) rgba.fill(raw[source]!, target, target + 3);
    else rgba.set(raw.subarray(source, source + 3), target);
    rgba[target + 3] =
      colorType === 4 ? raw[source + 1]! : colorType === 6 ? raw[source + 3]! : 255;
  }
  return { width, height, bitDepth: 8, rgba };
}

/** Original Adobe-format 2x2 raw/PackBits PSD; never authored by ag-psd. */
export function originalPsd(
  planes: number[][],
  rle: boolean,
  merged = false,
  gray = false,
): Uint8Array {
  const layer = new Uint8Array(merged ? 56 : 0);
  if (merged) {
    const lv = new DataView(layer.buffer);
    lv.setUint32(0, 48);
    lv.setInt16(4, -1);
    layer.set([56, 66, 73, 77, 110, 111, 114, 109], 24);
    layer[32] = 255;
    lv.setUint32(36, 12);
  }
  const body: number[] = [],
    counts: number[] = [];
  for (const plane of planes)
    for (let row = 0; row < 2; row++) {
      const samples = plane.slice(row * 2, row * 2 + 2);
      if (rle) {
        counts.push(3);
        body.push(1, ...samples);
      } else body.push(...samples);
    }
  const bytes = new Uint8Array(40 + layer.length + (rle ? counts.length * 2 : 0) + body.length);
  const view = new DataView(bytes.buffer);
  bytes.set([56, 66, 80, 83]);
  view.setUint16(4, 1);
  view.setUint16(12, planes.length);
  view.setUint32(14, 2);
  view.setUint32(18, 2);
  view.setUint16(22, 8);
  view.setUint16(24, gray ? 1 : 3);
  view.setUint32(34, layer.length);
  bytes.set(layer, 38);
  let offset = 38 + layer.length;
  view.setUint16(offset, rle ? 1 : 0);
  offset += 2;
  for (const count of counts) {
    view.setUint16(offset, count);
    offset += 2;
  }
  bytes.set(body, offset);
  return bytes;
}
