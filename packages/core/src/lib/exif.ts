/**
 * Minimal EXIF orientation handling for JPEG images.
 *
 * @jsquash/jpeg's decoder returns raw pixel data without applying the EXIF
 * orientation tag — so photos taken in portrait mode on a phone (which set
 * EXIF orientation to rotate-90-CW and store the pixels in landscape) come
 * out of the decoder sideways.
 *
 * This module reads the EXIF orientation byte from a JPEG buffer and
 * applies the corresponding rotation/flip to an ImageData object. Call
 * `decodeJpegOrientation` with the raw JPEG bytes before decoding, then
 * `applyOrientation` on the decoded ImageData.
 *
 * Non-JPEG inputs always return orientation 1 (no change).
 */

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Parse EXIF orientation from a JPEG buffer. Returns 1 (identity) if:
 *  - buffer isn't a JPEG
 *  - buffer has no EXIF block (APP1 marker)
 *  - orientation tag is missing or out of range
 */
export function decodeJpegOrientation(buffer: ArrayBuffer): ExifOrientation {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return 1;
  // JPEG SOI marker
  if (view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset < view.byteLength) {
    if (offset + 4 > view.byteLength) return 1;
    const marker = view.getUint16(offset);
    offset += 2;
    // APP1 (EXIF)
    if (marker === 0xffe1) {
      // segment length includes the 2 length bytes
      const segmentLength = view.getUint16(offset);
      offset += 2;
      // Expect "Exif\0\0" header
      if (offset + 6 > view.byteLength) return 1;
      if (
        view.getUint32(offset) !== 0x45786966 /* 'Exif' */ ||
        view.getUint16(offset + 4) !== 0x0000
      )
        return 1;
      const tiffOffset = offset + 6;
      // TIFF header: II (little-endian) or MM (big-endian)
      const endian = view.getUint16(tiffOffset);
      const little = endian === 0x4949;
      if (!little && endian !== 0x4d4d) return 1;
      // Magic 0x002a
      if (view.getUint16(tiffOffset + 2, little) !== 0x002a) return 1;
      // Offset to 0th IFD
      const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, little);
      if (ifdOffset + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifdOffset, little);
      for (let i = 0; i < entries; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) return 1;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) {
          // Orientation — stored as SHORT (type 3), count 1, value in first 2 bytes of the value field
          const orientation = view.getUint16(entryOffset + 8, little);
          if (orientation >= 1 && orientation <= 8) return orientation as ExifOrientation;
          return 1;
        }
      }
      // No orientation tag in IFD
      return 1;
      // unreachable but keeps TS happy
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ignored = segmentLength;
    } else if ((marker & 0xff00) === 0xff00 && marker !== 0xffff) {
      // Other marker: skip its segment
      if (offset + 2 > view.byteLength) return 1;
      const segmentLength = view.getUint16(offset);
      offset += segmentLength;
    } else {
      return 1;
    }
  }
  return 1;
}

export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Apply the EXIF orientation to raw ImageData pixels, returning new
 * ImageData-shaped output. Orientation 1 is a no-op (same object back).
 *
 * Orientation map (EXIF spec):
 *   1  normal
 *   2  flip horizontal
 *   3  rotate 180
 *   4  flip vertical
 *   5  flip horizontal + rotate 90 CW
 *   6  rotate 90 CW
 *   7  flip horizontal + rotate 90 CCW
 *   8  rotate 90 CCW
 */
export function applyOrientation(
  img: ImageDataLike,
  orientation: ExifOrientation,
): ImageDataLike {
  if (orientation === 1) return img;

  const { width: w, height: h, data: src } = img;
  const swap = orientation >= 5; // 5, 6, 7, 8 rotate 90° (swap dimensions)
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x;
      let dy = y;
      switch (orientation) {
        case 2:
          dx = w - 1 - x;
          dy = y;
          break;
        case 3:
          dx = w - 1 - x;
          dy = h - 1 - y;
          break;
        case 4:
          dx = x;
          dy = h - 1 - y;
          break;
        case 5:
          dx = y;
          dy = x;
          break;
        case 6:
          dx = h - 1 - y;
          dy = x;
          break;
        case 7:
          dx = h - 1 - y;
          dy = w - 1 - x;
          break;
        case 8:
          dx = y;
          dy = w - 1 - x;
          break;
      }
      const srcIdx = (y * w + x) * 4;
      const dstIdx = (dy * outW + dx) * 4;
      out[dstIdx] = src[srcIdx]!;
      out[dstIdx + 1] = src[srcIdx + 1]!;
      out[dstIdx + 2] = src[srcIdx + 2]!;
      out[dstIdx + 3] = src[srcIdx + 3]!;
    }
  }

  return { data: out, width: outW, height: outH };
}

/**
 * Convenience: decode EXIF orientation from a JPEG buffer (returns 1 for
 * non-JPEG inputs or buffers without EXIF) and apply it to decoded pixels.
 */
export function orientImageData(
  buffer: ArrayBuffer,
  mimeType: string,
  decoded: ImageDataLike,
): ImageDataLike {
  if (!mimeType.includes('jpeg') && !mimeType.includes('jpg')) return decoded;
  const orientation = decodeJpegOrientation(buffer);
  return applyOrientation(decoded, orientation);
}
