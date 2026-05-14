import type { ToolModule, ToolRunContext } from '../../types.js';

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

  defaults,

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

  async run(
    inputs: File[],
    params: PdfCompressParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const imageQuality = params.imageQuality ?? defaults.imageQuality;
    const pngToJpeg = params.pngToJpeg ?? defaults.pngToJpeg;

    if (imageQuality < 1 || imageQuality > 100) {
      throw new Error('imageQuality must be between 1 and 100.');
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });

    const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib');
    const buffer = await inputs[0]!.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Scanning for images' });

    // Walk the PDF objects looking for image XObjects
    const { encode: encodeJpeg } = await import('@jsquash/jpeg');
    const { decode: decodePng } = await import('@jsquash/png');
    const { decode: decodeJpeg } = await import('@jsquash/jpeg');

    let imagesProcessed = 0;

    const context = pdfDoc.context;
    const indirectObjects = (context as unknown as { indirectObjects: Map<unknown, unknown> }).indirectObjects;

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

        ctx.onProgress({
          stage: 'processing',
          percent: 20 + Math.floor((i / entries.length) * 60),
          message: `Re-encoding image ${imagesProcessed + 1}`,
        });

        try {
          let imageData: ImageData | null = null;

          if (isJpeg) {
            imageData = await decodeJpeg(obj.contents.slice().buffer);
          } else if (isPng && (pngToJpeg || true)) {
            // Check if it has alpha channel — if so, we can't convert to JPEG
            const colorSpaceStr = colorSpaceObj ? colorSpaceObj.toString() : '';
            if (colorSpaceStr.includes('DeviceRGB') || colorSpaceStr === '') {
              imageData = await decodePng(obj.contents.slice().buffer);
            }
          }

          if (!imageData) continue;

          // Re-encode as JPEG
          const quality = imageQuality / 100;
          const jpegBytes = await encodeJpeg(imageData, { quality });

          // Replace stream contents
          const newContents = new Uint8Array(jpegBytes);
          // Rebuild the stream: update filter and length
          dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
          dict.delete(PDFName.of('DecodeParms'));
          // Replace contents directly
          (obj as unknown as { contents: Uint8Array }).contents = newContents;

          imagesProcessed++;
        } catch {
          // Skip images that fail to decode/encode — best effort
        }
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 85, message: 'Saving PDF' });
    const bytes = await pdfDoc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: `Done — ${imagesProcessed} image(s) re-encoded` });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
