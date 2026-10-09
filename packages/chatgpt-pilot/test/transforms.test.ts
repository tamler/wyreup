import { createHash } from 'node:crypto';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { compareDimensions, processJob, validateDimensions } from '../src/process-job.js';
import type { WorkerRequest } from '../src/types.js';

function tight(input: Uint8Array): ArrayBuffer { return Uint8Array.from(input).buffer; }

function job(operation: WorkerRequest['operation'], inputs: ArrayBuffer[]): WorkerRequest {
  return { operation, inputs, targetKb: 200, allowDownscale: true };
}

describe('image gates and actual core transformations', () => {
  it.each([[0,1], [1,0], [-1,1], [1.5,2], [Number.MAX_SAFE_INTEGER + 1,1], [undefined,2]])('rejects invalid header dimensions', (width, height) => {
    expect(() => validateDimensions(width, height)).toThrow();
  });

  it('checks the pixel product explicitly and rejects decode/header mismatch before orientation', () => {
    expect(validateDimensions(4000,4000)).toEqual({ width: 4000, height: 4000 });
    expect(() => validateDimensions(4001,4000)).toThrow('16 megapixel');
    expect(() => compareDimensions({ width: 20, height: 10 }, { width: 10, height: 20 })).toThrow();
    expect(() => compareDimensions({ width: 20, height: 10 }, { width: 0, height: 10 })).toThrow();
  });

  it('rejects corrupt small images instead of accepting compression passthrough', async () => {
    const bytes = tight(Uint8Array.of(255,216,255,0,1,2,3,4));
    await expect(processJob(job('compress_image_to_size', [bytes]))).rejects.toHaveProperty('code', 'INVALID_FILE');
  });

  it('validates an under-target image and returns unchanged exact bytes with honest target metadata', async () => {
    const bytes = tight(await sharp({ create: { width: 20, height: 10, channels: 3, background: '#4477aa' } }).jpeg().toBuffer());
    const before = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    const result = await processJob(job('compress_image_to_size', [bytes]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected success.');
    expect(result.details.targetReached).toBe(true);
    expect(result.details.output.mimeType).toBe('image/jpeg');
    expect(Buffer.from(result.bytes)).toEqual(Buffer.from(bytes));
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).toBe(before);
  });

  it('removes actual EXIF and preserves baked orientation without modifying the input', async () => {
    const source = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#aa7733' } })
      .jpeg().withExif({ IFD0: { Artist: 'PRIVATE_METADATA_CANARY' } }).withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(source).metadata()).orientation).toBe(6);
    const result = await processJob(job('strip_image_metadata', [tight(source)]));
    if (!result.ok) throw new Error('Expected success.');
    const metadata = await sharp(Buffer.from(result.bytes)).metadata();
    expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 10, height: 20 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(Buffer.from(result.bytes).includes(Buffer.from('PRIVATE_METADATA_CANARY'))).toBe(false);
    expect((await sharp(source).metadata()).orientation).toBe(6);
  });

  it('rejects an oversized signed image header and animation control', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(16000001, 16);
    await expect(processJob(job('strip_image_metadata', [tight(oversized)]))).rejects.toHaveProperty('code');
    const animation = Buffer.concat([png.subarray(0,33), Buffer.from([0,0,0,8,97,99,84,76,0,0,0,2,0,0,0,0,0,0,0,0]), png.subarray(33)]);
    await expect(processJob(job('strip_image_metadata', [tight(animation)]))).rejects.toHaveProperty('code', 'INVALID_FILE');
  });
});

async function pdf(marker: string, width: number, count = 1): Promise<ArrayBuffer> {
  const document = await PDFDocument.create();
  for (let i = 0; i < count; i++) document.addPage([width,200]).drawText(marker);
  return tight(await document.save());
}

describe('actual ordered PDF merge', () => {
  it('preserves ordered page content and page counts', async () => {
    const inputs = [await pdf('ORDER_A',100), await pdf('ORDER_B',200)];
    const before = inputs.map(input => createHash('sha256').update(new Uint8Array(input)).digest('hex'));
    const result = await processJob(job('merge_pdfs', inputs));
    if (!result.ok) throw new Error('Expected success.');
    expect(result.details.pageCount).toBe(2);
    expect(result.details.inputOrder).toEqual([1,2]);
    const document = await PDFDocument.load(result.bytes);
    expect(document.getPages().map(page => page.getWidth())).toEqual([100,200]);
    document.getPages().forEach((page,index) => {
      const contents = page.node.Contents();
      if (!(contents instanceof PDFArray)) throw new Error('Expected page streams.');
      const stream = document.context.lookup(contents.get(0));
      if (!(stream instanceof PDFRawStream)) throw new Error('Expected encoded page stream.');
      const text = Buffer.from(decodePDFRawStream(stream).decode()).toString();
      expect(text).toContain(Buffer.from(index === 0 ? 'ORDER_A' : 'ORDER_B').toString('hex').toUpperCase());
    });
    expect(inputs.map(input => createHash('sha256').update(new Uint8Array(input)).digest('hex'))).toEqual(before);
  });

  it('rejects malformed PDFs and combined page counts above 100 before merge', async () => {
    await expect(processJob(job('merge_pdfs', [tight(Buffer.from('%PDF-1.7\ninvalid')), await pdf('VALID',100)]))).rejects.toHaveProperty('code', 'INVALID_FILE');
    await expect(processJob(job('merge_pdfs', [await pdf('ONE',100,51), await pdf('TWO',100,50)]))).rejects.toHaveProperty('code', 'PDF_PAGE_LIMIT');
  });
});
