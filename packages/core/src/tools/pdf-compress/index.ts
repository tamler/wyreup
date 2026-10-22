import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';
import { pickSmaller } from '../../lib/pick-smaller.js';
import { getCodec, type Codec } from '../../lib/codecs.js';

export interface PdfCompressParams {
  /** JPEG quality for embedded images, 1-100. Default 75. */
  imageQuality?: number;
  /** Convert PNG images to JPEG for smaller size? Default true. */
  pngToJpeg?: boolean;
}

const defaults: Required<PdfCompressParams> = {
  imageQuality: 75,
  pngToJpeg: true,
};

export const pdfCompress: ToolModule<PdfCompressParams> = {
  id: 'pdf-compress',
  slug: 'pdf-compress',
  name: 'Compress PDF',
  description:
    'Reduces PDF size by re-encoding embedded images. Does not remove unused resources, subset fonts, or repair stream encoding.',
  llmDescription:
    'Compress a PDF to reduce file size. Use when the user needs to shrink a PDF for email or upload.',
  category: 'optimize',
  keywords: ['pdf', 'compress', 'optimize', 'reduce', 'size', 'images'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  budget: { maxPages: 2_000 },

  defaults,

  chainSuggestions: ['merge-pdf', 'pdf-encrypt', 'watermark-pdf', 'pdf-to-text', 'split-pdf'],
  paramSchema: {
    imageQuality: {
      type: 'range',
      label: 'image quality',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
      help: 'JPEG quality for embedded images. Lower = smaller file.',
    },
    pngToJpeg: {
      type: 'boolean',
      label: 'convert PNG to JPEG',
      help: 'Re-encode PNG images as JPEG for additional size reduction.',
    },
  },

  async run(inputs: File[], params: PdfCompressParams, ctx: ToolRunContext): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const imageQuality = params.imageQuality ?? defaults.imageQuality;
    const pngToJpeg = params.pngToJpeg ?? defaults.pngToJpeg;

    if (imageQuality < 1 || imageQuality > 100) {
      throw new Error('imageQuality must be between 1 and 100.');
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });

    const { PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } =
      await import('pdf-lib');
    const buffer = await inputs[0]!.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer);
    assertPdfPageBudget(pdfDoc.getPageCount(), { maxPages: 2_000 });

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Scanning for images' });

    // Walk the PDF objects looking for image XObjects. Use the shared codec
    // loader so jSquash's WASM is initialized correctly in Node/CLI/MCP.
    let jpegCodecPromise: Promise<Codec> | null = null;
    const loadJpegCodec = () => (jpegCodecPromise ??= getCodec('jpeg'));
    let imagesProcessed = 0;
    let imagesAttempted = 0;
    let lastImageError: unknown;

    const context = pdfDoc.context;
    const indirectObjects = (context as unknown as { indirectObjects: Map<unknown, unknown> })
      .indirectObjects;

    if (indirectObjects) {
      const entries = Array.from(indirectObjects.entries());
      for (let i = 0; i < entries.length; i++) {
        if (ctx.signal.aborted) throw new Error('Aborted');

        const [, obj] = entries[i]!;
        if (!(obj instanceof PDFRawStream)) continue;

        const dict = obj.dict;
        const subtypeObj = dict.get(PDFName.of('Subtype'));
        if (!subtypeObj || subtypeObj.toString() !== '/Image') continue;

        const colorSpaceObj = dict.get(PDFName.of('ColorSpace'));
        const filterObj = dict.get(PDFName.of('Filter'));
        if (!filterObj) continue;

        const filterStr = filterObj.toString();
        const isJpeg = filterStr === '/DCTDecode';
        const isPng = filterStr === '/FlateDecode';

        if (!isJpeg && !isPng) continue;

        const widthObj = dict.get(PDFName.of('Width'));
        const heightObj = dict.get(PDFName.of('Height'));
        if (!widthObj || !heightObj) continue;

        const width = parseInt(widthObj.toString(), 10);
        const height = parseInt(heightObj.toString(), 10);
        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) continue;
        const pixelCount = width * height;
        if (!Number.isSafeInteger(pixelCount) || pixelCount > 100_000_000) continue;

        try {
          let imageData: {
            data: Uint8ClampedArray;
            width: number;
            height: number;
          } | null = null;

          if (isJpeg) {
            imagesAttempted++;
            ctx.onProgress({
              stage: 'processing',
              percent: 20 + Math.floor((i / entries.length) * 60),
              message: `Re-encoding image ${imagesAttempted}`,
            });
            const jpegCodec = await loadJpegCodec();
            imageData = await jpegCodec.decode(obj.contents.slice());
          } else if (isPng && pngToJpeg) {
            const colorSpace = colorSpaceObj?.toString();
            const bits = Number.parseInt(
              dict.get(PDFName.of('BitsPerComponent'))?.toString() ?? '',
              10,
            );
            const hasAlphaOrMask =
              dict.get(PDFName.of('SMask')) !== undefined ||
              dict.get(PDFName.of('Mask')) !== undefined;
            const hasPredictor = dict.get(PDFName.of('DecodeParms')) !== undefined;
            const channels = colorSpace === '/DeviceRGB' ? 3 : colorSpace === '/DeviceGray' ? 1 : 0;

            // A FlateDecode PDF image is raw pixel samples, not a PNG file.
            // Support the unambiguous opaque 8-bit RGB/gray form and leave
            // indexed, alpha-masked, predicted, and CMYK streams untouched.
            if (channels > 0 && bits === 8 && !hasAlphaOrMask && !hasPredictor) {
              imagesAttempted++;
              ctx.onProgress({
                stage: 'processing',
                percent: 20 + Math.floor((i / entries.length) * 60),
                message: `Re-encoding image ${imagesAttempted}`,
              });
              const decoded = decodePDFRawStream(obj).decode();
              const expectedLength = pixelCount * channels;
              if (decoded.length !== expectedLength) {
                throw new Error(
                  `Decoded image has ${decoded.length} bytes; expected ${expectedLength}`,
                );
              }
              const rgba = new Uint8ClampedArray(pixelCount * 4);
              for (let pixel = 0; pixel < pixelCount; pixel++) {
                const source = pixel * channels;
                const target = pixel * 4;
                const red = decoded[source]!;
                rgba[target] = red;
                rgba[target + 1] = channels === 3 ? decoded[source + 1]! : red;
                rgba[target + 2] = channels === 3 ? decoded[source + 2]! : red;
                rgba[target + 3] = 255;
              }
              imageData = { data: rgba, width, height };
            }
          }

          if (!imageData) continue;

          // Re-encode as JPEG
          const quality = imageQuality / 100;
          const jpegCodec = await loadJpegCodec();
          const jpegBytes = await jpegCodec.encode(imageData, { quality });

          // Replace stream contents
          const newContents = new Uint8Array(jpegBytes);
          // Rebuild the stream: update filter and length
          dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
          dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
          dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
          dict.delete(PDFName.of('DecodeParms'));
          dict.delete(PDFName.of('Decode'));
          // Replace contents directly
          (obj as unknown as { contents: Uint8Array }).contents = newContents;

          imagesProcessed++;
        } catch (error) {
          lastImageError = error;
        }
      }
    }

    if (imagesAttempted > 0 && imagesProcessed === 0) {
      const detail = lastImageError instanceof Error ? `: ${lastImageError.message}` : '';
      throw new Error(
        `Could not re-encode any of ${imagesAttempted} supported PDF images${detail}`,
      );
    }

    ctx.onProgress({ stage: 'encoding', percent: 85, message: 'Saving PDF' });
    const bytes = await pdfDoc.save();
    const result = pickSmaller(
      { bytes: buffer, mime: 'application/pdf' },
      { bytes, mime: 'application/pdf' },
    );

    ctx.onProgress({
      stage: 'done',
      percent: 100,
      message: result.keptOriginal
        ? `Done — ${imagesProcessed} image(s) re-encoded, but the result was not smaller; keeping the original`
        : `Done — ${imagesProcessed} image(s) re-encoded`,
    });
    return new Blob([result.bytes as BlobPart], { type: result.mime });
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
