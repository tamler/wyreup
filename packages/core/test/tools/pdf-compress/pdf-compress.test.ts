import { describe, it, expect } from 'vitest';
import { pdfCompress } from '../../../src/tools/pdf-compress/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(aborted = false): ToolRunContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    onProgress: () => {},
    signal: controller.signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pdf-compress — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfCompress.id).toBe('pdf-compress');
    expect(pdfCompress.category).toBe('optimize');
  });

  it('output mime is application/pdf', () => {
    expect(pdfCompress.output.mime).toBe('application/pdf');
  });

  it('description mentions image re-encoding limitation', () => {
    expect(pdfCompress.description).toContain('re-encoding embedded images');
  });
});

describe('pdf-compress — run()', () => {
  it('processes a PDF without errors (no embedded images)', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfCompress.run([input], {}, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('throws for invalid imageQuality', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(pdfCompress.run([input], { imageQuality: 0 }, makeCtx())).rejects.toThrow(
      'imageQuality',
    );
  });

  it('respects abort signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(pdfCompress.run([input], {}, makeCtx(true))).rejects.toThrow('Aborted');
  });

  it('re-encodes an embedded JPEG in Node instead of silently skipping it', async () => {
    const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib');
    const sourceImage = loadFixture('photo.jpg', 'image/jpeg');
    const sourceBytes = new Uint8Array(await sourceImage.arrayBuffer());
    const pdf = await PDFDocument.create();
    const image = await pdf.embedJpg(sourceBytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    const initialSaved = await pdf.save();
    const preparedPdf = await PDFDocument.load(initialSaved);
    const imageStream = Array.from(
      (
        preparedPdf.context as unknown as { indirectObjects: Map<unknown, unknown> }
      ).indirectObjects.values(),
    ).find(
      (object) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    ) as
      { dict: { get(key: unknown): unknown; set(key: unknown, value: unknown): void } } | undefined;
    expect(imageStream).toBeDefined();
    imageStream!.dict.set(PDFName.of('DecodeParms'), PDFName.of('StaleParms'));
    imageStream!.dict.set(PDFName.of('Decode'), PDFName.of('StaleDecode'));
    const saved = await preparedPdf.save();
    const input = new File(
      [saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer],
      'photo.pdf',
      { type: 'application/pdf' },
    );
    const messages: Array<string | undefined> = [];
    const ctx = makeCtx();
    ctx.onProgress = (progress) => messages.push(progress.message);

    const result = await pdfCompress.run([input], { imageQuality: 10 }, ctx);
    const output = Array.isArray(result) ? result[0]! : result;
    const outputPdf = await PDFDocument.load(await output.arrayBuffer());
    const outputImage = Array.from(
      (
        outputPdf.context as unknown as {
          indirectObjects: Map<unknown, unknown>;
        }
      ).indirectObjects.values(),
    ).find(
      (object) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    ) as { dict: { get(key: unknown): { toString(): string } | undefined } } | undefined;

    expect(messages.some((message) => message?.includes('1 image(s) re-encoded'))).toBe(true);
    expect(outputImage?.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
    expect(outputImage?.dict.get(PDFName.of('ColorSpace'))?.toString()).toBe('/DeviceRGB');
    expect(outputImage?.dict.get(PDFName.of('BitsPerComponent'))?.toString()).toBe('8');
    expect(outputImage?.dict.get(PDFName.of('DecodeParms'))).toBeUndefined();
    expect(outputImage?.dict.get(PDFName.of('Decode'))).toBeUndefined();
  });

  it('honors pngToJpeg=false without attempting PNG conversion', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const sourceImage = loadFixture('graphic.png', 'image/png');
    const sourceBytes = new Uint8Array(await sourceImage.arrayBuffer());
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(sourceBytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    const saved = await pdf.save();
    const input = new File(
      [saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer],
      'graphic.pdf',
      { type: 'application/pdf' },
    );
    const messages: Array<string | undefined> = [];
    const ctx = makeCtx();
    ctx.onProgress = (progress) => messages.push(progress.message);

    const result = await pdfCompress.run([input], { pngToJpeg: false }, ctx);
    const output = Array.isArray(result) ? result[0]! : result;

    expect(output.size).toBe(input.size);
    expect(messages.some((message) => message?.startsWith('Re-encoding image'))).toBe(false);
  });
});
