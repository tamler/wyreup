export interface PsdComposite {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  alphaSource: 'merged-transparency' | 'explicit-channel' | 'opaque';
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('PSD conversion cancelled.');
}

function ownedRgba(value: Uint8ClampedArray): value is Uint8ClampedArray<ArrayBuffer> {
  return value instanceof Uint8ClampedArray && value.buffer instanceof ArrayBuffer;
}

export function readPsdComposite(
  bytes: Uint8Array,
  alphaMode: 'auto' | 'channel-as-transparency' = 'auto',
  signal?: AbortSignal,
): PsdComposite {
  cancelled(signal);
  if (!(bytes instanceof Uint8Array) || bytes.length < 40 || bytes.length > 64 * 1024 * 1024)
    throw new Error('PSD must be a complete file of at most 64 MiB.');
  if (!['auto', 'channel-as-transparency'].includes(alphaMode))
    throw new Error('Unsupported PSD alpha mode.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const requireRange = (offset: number, length: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > bytes.length
    )
      throw new Error('Truncated or invalid PSD section.');
  };
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS' || view.getUint16(4) !== 1)
    throw new Error('Only version1 PSD is supported; PSB is not supported.');
  if (bytes.subarray(6, 12).some((value) => value !== 0))
    throw new Error('Invalid PSD reserved header.');
  const channels = view.getUint16(12),
    height = view.getUint32(14),
    width = view.getUint32(18),
    depth = view.getUint16(22),
    mode = view.getUint16(24);
  const pixels = width * height;
  if (!width || !height || width > 8192 || height > 8192 || pixels > 16000000 || depth !== 8)
    throw new Error(
      'PSD requires 8-bit channels, dimensions up to8192, and at most16million pixels.',
    );
  if (!(
    (mode === 3 && (channels === 3 || channels === 4)) ||
    (mode === 1 && (channels === 1 || channels === 2))
  ))
    throw new Error('Only RGB3/4 and grayscale1/2 channel PSD composites are supported.');
  let offset = 26;
  let merged = false;
  for (let section = 0; section < 3; section++) {
    requireRange(offset, 4);
    const length = view.getUint32(offset);
    offset += 4;
    requireRange(offset, length);
    if (section === 0 && length)
      throw new Error('Nonempty color-mode data is unsupported for RGB/grayscale.');
    if (section === 2 && length) {
      if (length < 4) throw new Error('Invalid layer-mask section.');
      const layerLength = view.getUint32(offset);
      if (layerLength > length - 4 || (layerLength !== 0 && layerLength < 2))
        throw new Error('Invalid layer-info section.');
      if (layerLength) merged = view.getInt16(offset + 4) < 0;
    }
    offset += length;
  }
  requireRange(offset, 2);
  const compression = view.getUint16(offset);
  offset += 2;
  if (compression !== 0 && compression !== 1)
    throw new Error(
      'Only raw and PackBits RLE composites are supported; ZIP modes are unsupported.',
    );
  const planeBytes = pixels * channels;
  const planes = new Uint8Array(planeBytes);
  if (compression === 0) {
    requireRange(offset, planeBytes);
    if (offset + planeBytes !== bytes.length)
      throw new Error('PSD composite contains trailing or missing bytes.');
    planes.set(bytes.subarray(offset));
  } else {
    const rowCount = channels * height;
    requireRange(offset, rowCount * 2);
    let cursor = offset + rowCount * 2;
    for (let row = 0; row < rowCount; row++) {
      cancelled(signal);
      const length = view.getUint16(offset + row * 2);
      requireRange(cursor, length);
      const end = cursor + length;
      let written = 0;
      const base = row * width;
      while (cursor < end) {
        const control = view.getInt8(cursor++);
        if (control === -128) continue;
        const count = control >= 0 ? control + 1 : 1 - control;
        if (written + count > width) throw new Error('PackBits row exceeds declared width.');
        if (control >= 0) {
          if (cursor + count > end) throw new Error('Truncated PackBits literal.');
          planes.set(bytes.subarray(cursor, cursor + count), base + written);
          cursor += count;
        } else {
          if (cursor >= end) throw new Error('Truncated PackBits repeat.');
          planes.fill(bytes[cursor++]!, base + written, base + written + count);
        }
        written += count;
      }
      if (written !== width) throw new Error('PackBits row does not fill declared width.');
    }
    if (cursor !== bytes.length) throw new Error('PSD composite contains trailing bytes.');
  }
  const extra = channels === (mode === 3 ? 4 : 2);
  if (merged && !extra) throw new Error('Merged-transparency flag has no extra channel.');
  if (alphaMode === 'channel-as-transparency' && !extra)
    throw new Error('Explicit transparency requires an extra channel.');
  const alpha = extra && (merged || alphaMode === 'channel-as-transparency');
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel++) {
    if ((pixel & 4095) === 0) cancelled(signal);
    const a = alpha ? planes[(channels - 1) * pixels + pixel]! : 255;
    for (let channel = 0; channel < 3; channel++) {
      const stored = planes[(mode === 1 ? 0 : channel) * pixels + pixel]!;
      rgba[pixel * 4 + channel] =
        merged && alpha && a > 0 && a < 255
          ? Math.min(255, Math.max(0, Math.round((stored * 255) / a + 255 * (1 - 255 / a))))
          : stored;
    }
    rgba[pixel * 4 + 3] = a;
  }
  cancelled(signal);
  return {
    width,
    height,
    rgba,
    alphaSource: alpha ? (merged ? 'merged-transparency' : 'explicit-channel') : 'opaque',
  };
}

export function canonicalCompositePsd(composite: PsdComposite): Uint8Array {
  const { width, height, rgba } = composite;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16000000 ||
    !ownedRgba(rgba) ||
    rgba.length !== width * height * 4
  )
    throw new Error('Invalid bounded RGBA composite.');
  const pixels = width * height;
  const bytes = new Uint8Array(40 + pixels * 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53]);
  view.setUint16(4, 1);
  view.setUint16(12, 4);
  view.setUint32(14, height);
  view.setUint32(18, width);
  view.setUint16(22, 8);
  view.setUint16(24, 3);
  for (let pixel = 0; pixel < pixels; pixel++)
    for (let channel = 0; channel < 4; channel++)
      bytes[40 + channel * pixels + pixel] = rgba[pixel * 4 + channel]!;
  return bytes;
}

export async function decodeCanonicalCompositeInWorker(
  composite: PsdComposite,
): Promise<PsdComposite> {
  const canonical = canonicalCompositePsd(composite);
  const rgba = composite.rgba;
  if (!ownedRgba(rgba)) throw new Error('Invalid bounded RGBA composite.');
  const { initializeCanvas, readPsd } = await import('ag-psd');
  initializeCanvas(
    () => {
      throw new Error('Composite decoding cannot create a layer or thumbnail canvas.');
    },
    (width, height) => {
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width * height > 16000000 ||
        width !== composite.width ||
        height !== composite.height
      )
        throw new Error('PSD image-data allocation exceeds the pixel budget.');
      return { width, height, data: rgba, colorSpace: 'srgb' };
    },
  );
  const decoded = readPsd(canonical, {
    useImageData: true,
    skipLayerImageData: true,
    skipCompositeImageData: false,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    totalMemoryLimit: 96 * 1024 * 1024,
    throwForMissingFeatures: true,
    useRawData: false,
  });
  if (
    !decoded.imageData ||
    !(decoded.imageData.data instanceof Uint8ClampedArray) ||
    decoded.imageData.data.length !== composite.rgba.length
  )
    throw new Error('PSD composite decoder did not return complete 8-bit RGBA data.');
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.imageData.data,
    alphaSource: composite.alphaSource,
  };
}
