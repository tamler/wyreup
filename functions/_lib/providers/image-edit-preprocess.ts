// Isolated candidate adapter: not imported by the Pro route or connected to an Images binding.
// Mocked checks do not establish animation, metadata, billing, or runtime guarantees.

export interface ImageEditImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<unknown>;
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; height: number; fit: 'scale-down' }): {
      output(options: { format: 'image/png'; anim: false }): Promise<{ response(): Response }>;
    };
  };
}

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_SIDE = 12_000;
const MAX_SOURCE_AREA = 100_000_000;
const MAX_RESULT_SIDE = 511;

function streamFor(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([Uint8Array.from(bytes).buffer]).stream();
}

function infoFields(value: unknown, byteLength: number): { format: string; width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid image info');
  const info = value as Record<string, unknown>;
  const { format, width, height, fileSize } = info;
  if (typeof format !== 'string' || typeof width !== 'number' || typeof height !== 'number' ||
      typeof fileSize !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(fileSize) || width < 1 || height < 1 || fileSize !== byteLength) {
    throw new Error('Invalid image info');
  }
  return { format, width, height };
}

async function readBounded(response: Response): Promise<Uint8Array> {
  if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/png') {
    await response.body?.cancel();
    throw new Error('Invalid image transform response');
  }
  if (Number(response.headers.get('content-length')) > MAX_OUTPUT_BYTES) {
    await response.body?.cancel();
    throw new Error('Transformed image exceeds limit');
  }
  if (!response.body) throw new Error('Empty image transform response');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_OUTPUT_BYTES) throw new Error('Transformed image exceeds limit');
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (length < 24) throw new Error('Invalid transformed PNG');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export async function prepareImageForEditing(
  binding: ImageEditImagesBinding,
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; mime: 'image/png'; width: number; height: number }> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_INPUT_BYTES) {
    throw new Error('Invalid input image size');
  }
  const source = infoFields(await binding.info(streamFor(bytes)), bytes.length);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(source.format) ||
      source.width > MAX_SOURCE_SIDE || source.height > MAX_SOURCE_SIDE ||
      source.width * source.height > MAX_SOURCE_AREA) {
    throw new Error('Unsupported input image');
  }
  const result = await binding.input(streamFor(bytes))
    .transform({ width: MAX_RESULT_SIDE, height: MAX_RESULT_SIDE, fit: 'scale-down' })
    .output({ format: 'image/png', anim: false });
  const output = await readBounded(result.response());
  const info = infoFields(await binding.info(streamFor(output)), output.length);
  if (info.format !== 'image/png' || info.width > MAX_RESULT_SIDE || info.height > MAX_RESULT_SIDE) {
    throw new Error('Unsupported transformed image');
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (!signature.every((value, i) => output[i] === value)) throw new Error('Invalid transformed PNG');
  const header = new DataView(output.buffer, output.byteOffset, output.byteLength);
  if (header.getUint32(16) !== info.width || header.getUint32(20) !== info.height) {
    throw new Error('Transformed image dimensions disagree');
  }
  return { bytes: output, mime: 'image/png', width: info.width, height: info.height };
}
