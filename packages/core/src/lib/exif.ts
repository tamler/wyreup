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
      // Skip the 2-byte segment-length header; we walk the IFD directly.
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

/**
 * Compose an existing EXIF orientation with a clockwise rotation (90/180/270).
 * Models orientations as elements of the dihedral group D4: rotations preserve
 * flip parity, so the table covers all 8 starting orientations including the
 * four flipped ones (2, 4, 5, 7).
 */
export function composeOrientation(
  existing: ExifOrientation,
  rotationDegrees: 90 | 180 | 270,
): ExifOrientation {
  const ROT_RIGHT: Record<ExifOrientation, ExifOrientation> = {
    1: 6, 2: 7, 3: 8, 4: 5, 5: 2, 6: 3, 7: 4, 8: 1,
  };
  const ROT_180: Record<ExifOrientation, ExifOrientation> = {
    1: 3, 2: 4, 3: 1, 4: 2, 5: 7, 6: 8, 7: 5, 8: 6,
  };
  const ROT_LEFT: Record<ExifOrientation, ExifOrientation> = {
    1: 8, 2: 5, 3: 6, 4: 7, 5: 4, 6: 1, 7: 2, 8: 3,
  };
  if (rotationDegrees === 90) return ROT_RIGHT[existing];
  if (rotationDegrees === 180) return ROT_180[existing];
  return ROT_LEFT[existing];
}

/**
 * Rewrite the EXIF Orientation tag in a JPEG buffer in place.
 *
 * Returns a new Uint8Array of identical length (only 2 bytes change inside
 * the existing EXIF segment) on success, or null when no rewriteable
 * orientation tag is present — caller should fall back to decode/re-encode.
 *
 * "Lossless rotation" relies on this: the encoded image data is preserved
 * byte-for-byte, only the metadata flag changes.
 */
export function setJpegOrientation(
  buffer: ArrayBuffer,
  newOrientation: ExifOrientation,
): Uint8Array | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return null;
  if (view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset < view.byteLength) {
    if (offset + 4 > view.byteLength) return null;
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xffe1) {
      offset += 2;
      if (offset + 6 > view.byteLength) return null;
      if (
        view.getUint32(offset) !== 0x45786966 ||
        view.getUint16(offset + 4) !== 0x0000
      ) {
        return null;
      }
      const tiffOffset = offset + 6;
      const endian = view.getUint16(tiffOffset);
      const little = endian === 0x4949;
      if (!little && endian !== 0x4d4d) return null;
      if (view.getUint16(tiffOffset + 2, little) !== 0x002a) return null;
      const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, little);
      if (ifdOffset + 2 > view.byteLength) return null;
      const entries = view.getUint16(ifdOffset, little);
      for (let i = 0; i < entries; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) return null;
        if (view.getUint16(entryOffset, little) === 0x0112) {
          const out = new Uint8Array(buffer.slice(0));
          const outView = new DataView(out.buffer);
          outView.setUint16(entryOffset + 8, newOrientation, little);
          return out;
        }
      }
      return null;
    } else if ((marker & 0xff00) === 0xff00 && marker !== 0xffff) {
      if (offset + 2 > view.byteLength) return null;
      const segmentLength = view.getUint16(offset);
      offset += segmentLength;
    } else {
      return null;
    }
  }
  return null;
}

/**
 * Insert a minimal APP1/EXIF segment containing only an Orientation tag,
 * right after the SOI marker. Used when a JPEG has no EXIF block at all
 * but we still want a lossless rotation. Adds 36 bytes of metadata; the
 * encoded image data (DCT coefficients) is untouched.
 */
export function injectJpegOrientation(
  buffer: ArrayBuffer,
  orientation: ExifOrientation,
): Uint8Array | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return null;
  if (view.getUint16(0) !== 0xffd8) return null;

  const block = new Uint8Array(36);
  const dv = new DataView(block.buffer);
  // APP1 marker + length (big-endian; length includes itself, excludes the marker).
  dv.setUint16(0, 0xffe1);
  dv.setUint16(2, 34);
  // "Exif\0\0"
  block.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  // TIFF header: little-endian "II", magic 0x002A.
  block.set([0x49, 0x49, 0x2a, 0x00], 10);
  // IFD0 offset (relative to the start of the TIFF header) = 8.
  dv.setUint32(14, 8, true);
  // One IFD entry: Orientation tag (0x0112), type SHORT (3), count 1.
  dv.setUint16(18, 1, true);
  dv.setUint16(20, 0x0112, true);
  dv.setUint16(22, 3, true);
  dv.setUint32(24, 1, true);
  dv.setUint32(28, orientation, true);
  // Next IFD offset = 0 (no more IFDs).
  dv.setUint32(32, 0, true);

  const original = new Uint8Array(buffer);
  const out = new Uint8Array(original.length + 36);
  out.set(original.subarray(0, 2), 0);
  out.set(block, 2);
  out.set(original.subarray(2), 38);
  return out;
}
