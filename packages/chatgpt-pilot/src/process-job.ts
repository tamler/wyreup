import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { compressImageToSize, stripExif, mergePdf, getCodec } from './core-tools.js';
import { LIMITS, PilotError } from './limits.js';
import type { SuccessDetails, WorkerRequest, WorkerResponse } from './types.js';

type ImageFormat = 'jpeg' | 'png' | 'webp';
type Signature = ImageFormat | 'pdf';

function signature(bytes: Uint8Array): Signature {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0,4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.subarray(8,12)).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0,5)).toString('ascii') === '%PDF-') return 'pdf';
  throw new PilotError('INVALID_FILE');
}

function rejectAnimatedContainer(bytes: Uint8Array, format: ImageFormat): void {
  // libvips does not expose APNG frames on every build. Reject its explicit animation-control chunk.
  if (format === 'png') {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      if (length > buffer.length - offset - 12) throw new PilotError('INVALID_FILE');
      if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new PilotError('INVALID_FILE');
      offset += length + 12;
    }
  }
}

export function validateDimensions(width: number | undefined, height: number | undefined): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !width || !height || width < 0 || height < 0) {
    throw new PilotError('INVALID_FILE');
  }
  if (width > LIMITS.imagePixels / height) throw new PilotError('IMAGE_PIXEL_LIMIT');
  return { width, height };
}

export function compareDimensions(header: { width: number; height: number }, decoded: { width: number; height: number }): void {
  const actual = validateDimensions(decoded.width, decoded.height);
  if (actual.width !== header.width || actual.height !== header.height) throw new PilotError('INVALID_FILE');
}

async function validatedImage(bytes: ArrayBuffer): Promise<File> {
  const input = new Uint8Array(bytes);
  const format = signature(input);
  if (format === 'pdf') throw new PilotError('INVALID_FILE');
  rejectAnimatedContainer(input, format);
  const metadata = await sharp(input, { limitInputPixels: LIMITS.imagePixels, failOn: 'warning' }).metadata();
  if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new PilotError('INVALID_FILE');
  const header = validateDimensions(metadata.width, metadata.height);
  const decoded = await (await getCodec(format)).decode(bytes);
  // Compare raw, un-oriented dimensions before any transform or already-small passthrough.
  compareDimensions(header, decoded);
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  return new File([bytes], 'input-image', { type: mime });
}

async function imageFile(bytes: ArrayBuffer): Promise<File> {
  try { return await validatedImage(bytes); }
  catch (error) { throw error instanceof PilotError ? error : new PilotError('INVALID_FILE'); }
}

async function inspectPdf(bytes: ArrayBuffer): Promise<number> {
  try {
    const document = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
    const count = document.getPageCount();
    if (!Number.isSafeInteger(count) || count <= 0) throw new PilotError('INVALID_FILE');
    return count;
  }
  catch { throw new PilotError('INVALID_FILE'); }
}

export async function processJob(request: WorkerRequest): Promise<WorkerResponse> {
  const context = { signal: new AbortController().signal, cache: new Map<string, unknown>(), executionId: 'private-file-job', onProgress: (): void => {} };
  const details: Partial<SuccessDetails> = {};
  let output: Blob;
  if (request.operation === 'merge_pdfs') {
    let pages = 0;
    const inputs: File[] = [];
    for (const bytes of request.inputs) {
      if (signature(new Uint8Array(bytes)) !== 'pdf') throw new PilotError('INVALID_FILE');
      const count = await inspectPdf(bytes);
      pages += count;
      if (pages > LIMITS.pdfPages) throw new PilotError('PDF_PAGE_LIMIT');
      inputs.push(new File([bytes], 'input-document', { type: 'application/pdf' }));
    }
    const result = await mergePdf.run(inputs, {}, context);
    if (Array.isArray(result) || !(result instanceof Blob)) throw new PilotError('PROCESSING_FAILED');
    output = result;
    details.pageCount = pages;
    details.inputOrder = inputs.map((_input, index) => index + 1);
  } else {
    const input = await imageFile(request.inputs[0]!);
    if (request.operation === 'compress_image_to_size') {
      const outputs = await compressImageToSize.run([input], { targetKb: request.targetKb, allowDownscale: request.allowDownscale }, context);
      if (!Array.isArray(outputs) || outputs.length !== 1 || !outputs[0]) throw new PilotError('PROCESSING_FAILED');
      output = outputs[0];
      if (output.size > request.targetKb * 1024) throw new PilotError('TARGET_UNREACHABLE', undefined, {
        targetBytes: request.targetKb * 1024, smallestBytes: output.size,
      });
      details.targetReached = true;
      details.targetBytes = request.targetKb * 1024;
    } else {
      const outputs = await stripExif.run([input], {}, context);
      if (!Array.isArray(outputs) || outputs.length !== 1 || !outputs[0]) throw new PilotError('PROCESSING_FAILED');
      output = outputs[0];
    }
  }
  if (output.size <= 0 || output.size > LIMITS.outputBytes) throw new PilotError('OUTPUT_TOO_LARGE');
  const bytes = await output.arrayBuffer();
  const format = signature(new Uint8Array(bytes));
  const mimeType = format === 'pdf' ? 'application/pdf' : format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  if (mimeType !== output.type) throw new PilotError('PROCESSING_FAILED');
  if (request.operation === 'merge_pdfs') {
    const check = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
    if (check.getPageCount() !== details.pageCount) throw new PilotError('PROCESSING_FAILED');
  }
  const extension = format === 'jpeg' ? 'jpg' : format;
  const name = request.operation === 'merge_pdfs' ? 'merged.pdf' :
    `${request.operation === 'compress_image_to_size' ? 'compressed' : 'metadata-removed'}.${extension}`;
  return { ok: true, bytes, sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), details: {
    status: 'success', operation: request.operation, output: { name, mimeType, bytes: bytes.byteLength },
    inputBytes: request.inputs.reduce((sum, input) => sum + input.byteLength, 0), ...details,
  } };
}
