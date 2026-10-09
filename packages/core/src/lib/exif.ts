/**
 * EXIF orientation handling for JPEG, PNG, and WebP images.
 *
 * @jsquash/jpeg's decoder returns raw pixel data without applying the EXIF
 * orientation tag — so photos taken in portrait mode on a phone (which set
 * EXIF orientation to rotate-90-CW and store the pixels in landscape) come
 * out of the decoder sideways.
 *
 * Container readers bound TIFF offsets to the metadata payload. Orientation
 * is applied to decoded pixels before re-encoding without metadata.
 */

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface OrientationTag {
  orientation: ExifOrientation;
  valueOffset: number;
  little: boolean;
}

function hasBytes(view: DataView, offset: number, length: number, end = view.byteLength): boolean {
  return offset >= 0 && length >= 0 && end <= view.byteLength && offset <= end - length;
}

function isExifHeader(view: DataView, start: number, end: number): boolean {
  return (
    hasBytes(view, start, 6, end) &&
    view.getUint32(start) === 0x45786966 &&
    view.getUint16(start + 4) === 0
  );
}

/** Read only the IFD0 orientation tag; never follow offsets outside its TIFF payload. */
function tiffOrientation(view: DataView, start: number, end: number): OrientationTag | null {
  if (!hasBytes(view, start, 8, end)) return null;
  const endian = view.getUint16(start);
  const little = endian === 0x4949;
  if ((!little && endian !== 0x4d4d) || view.getUint16(start + 2, little) !== 42) return null;
  const relativeIfd = view.getUint32(start + 4, little);
  if (relativeIfd < 8) return null;
  const ifd = start + relativeIfd;
  if (!hasBytes(view, ifd, 2, end)) return null;
  const entries = view.getUint16(ifd, little);
  // The table includes a two-byte count, twelve bytes per entry, and a next-IFD pointer.
  if (!hasBytes(view, ifd, 2 + entries * 12 + 4, end)) return null;
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1)
      return null;
    const orientation = view.getUint16(entry + 8, little);
    if (orientation < 1 || orientation > 8) return null;
    return { orientation: orientation as ExifOrientation, valueOffset: entry + 8, little };
  }
  return null;
}

function jpegOrientationTag(view: DataView): OrientationTag | null {
  if (!hasBytes(view, 0, 2) || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    // JPEG permits consecutive 0xff fill bytes before a marker code.
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
    if (!hasBytes(view, offset, 1)) return null;
    const marker = view.getUint8(offset++);
    // Stop at compressed scan data or EOI; other lengthless markers are not metadata segments.
    if (
      marker === 0xda ||
      marker === 0xd9 ||
      marker === 0xd8 ||
      marker === 0x01 ||
      marker === 0 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      return null;
    if (!hasBytes(view, offset, 2)) return null;
    const length = view.getUint16(offset);
    if (length < 2 || !hasBytes(view, offset, length)) return null;
    const end = offset + length;
    const start = offset + 2;
    if (marker === 0xe1 && isExifHeader(view, start, end)) {
      return tiffOrientation(view, start + 6, end);
    }
    offset = end;
  }
  return null;
}

function pngOrientation(view: DataView): ExifOrientation {
  if (!hasBytes(view, 0, 8) || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a)
    return 1;
  let offset = 8;
  while (hasBytes(view, offset, 12)) {
    const length = view.getUint32(offset);
    if (length > 0x7fffffff || !hasBytes(view, offset, length + 12)) return 1;
    const type = view.getUint32(offset + 4);
    const start = offset + 8;
    if (type === 0x65584966) return tiffOrientation(view, start, start + length)?.orientation ?? 1;
    if (type === 0x49454e44) return 1;
    offset += length + 12;
  }
  return 1;
}

function webpOrientation(view: DataView): ExifOrientation {
  if (
    !hasBytes(view, 0, 12) ||
    view.getUint32(0) !== 0x52494646 ||
    view.getUint32(8) !== 0x57454250
  )
    return 1;
  const size = view.getUint32(4, true);
  if (size < 4 || size % 2 !== 0 || size > view.byteLength - 8) return 1;
  const end = size + 8;
  let offset = 12;
  while (hasBytes(view, offset, 8, end)) {
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const paddedLength = length + (length % 2);
    if (!hasBytes(view, start, paddedLength, end)) return 1;
    if (length % 2 !== 0 && view.getUint8(start + length) !== 0) return 1;
    if (view.getUint32(offset) === 0x45584946) {
      const tiffStart = isExifHeader(view, start, start + length) ? start + 6 : start;
      return tiffOrientation(view, tiffStart, start + length)?.orientation ?? 1;
    }
    offset = start + paddedLength;
  }
  return 1;
}

/**
 * Parse EXIF orientation from a JPEG buffer. Returns 1 (identity) if:
 *  - buffer isn't a JPEG
 *  - buffer has no EXIF block (APP1 marker)
 *  - orientation tag is missing or out of range
 */
export function decodeJpegOrientation(buffer: ArrayBuffer): ExifOrientation {
  return jpegOrientationTag(new DataView(buffer))?.orientation ?? 1;
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
export function applyOrientation(img: ImageDataLike, orientation: ExifOrientation): ImageDataLike {
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
 * Apply the supported container's EXIF orientation to decoded pixels.
 * Missing or malformed metadata leaves the decoded image unchanged.
 */
export function orientImageData(
  buffer: ArrayBuffer,
  mimeType: string,
  decoded: ImageDataLike,
): ImageDataLike {
  const mime = mimeType.toLowerCase();
  const view = new DataView(buffer);
  const orientation =
    mime === 'image/jpeg' || mime === 'image/jpg'
      ? decodeJpegOrientation(buffer)
      : mime === 'image/png'
        ? pngOrientation(view)
        : mime === 'image/webp'
          ? webpOrientation(view)
          : 1;
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
    1: 6,
    2: 7,
    3: 8,
    4: 5,
    5: 2,
    6: 3,
    7: 4,
    8: 1,
  };
  const ROT_180: Record<ExifOrientation, ExifOrientation> = {
    1: 3,
    2: 4,
    3: 1,
    4: 2,
    5: 7,
    6: 8,
    7: 5,
    8: 6,
  };
  const ROT_LEFT: Record<ExifOrientation, ExifOrientation> = {
    1: 8,
    2: 5,
    3: 6,
    4: 7,
    5: 4,
    6: 1,
    7: 2,
    8: 3,
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
  const tag = jpegOrientationTag(new DataView(buffer));
  if (!tag) return null;
  const out = new Uint8Array(buffer.slice(0));
  new DataView(out.buffer).setUint16(tag.valueOffset, newOrientation, tag.little);
  return out;
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
