import type { ToolModule, ToolRunContext } from '../../types.js';
import type { WatermarkPdfParams } from './types.js';

export type { WatermarkPdfParams } from './types.js';
export { defaultWatermarkPdfParams } from './types.js';

const WatermarkPdfComponentStub = (): unknown => null;

/** Parse a CSS hex color string like '#888888' into [r, g, b] 0-1 range for pdf-lib. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return { r, g, b };
}

export const watermarkPdf: ToolModule<WatermarkPdfParams> = {
  id: 'watermark-pdf',
  slug: 'watermark-pdf',
  name: 'Watermark PDF',
  description: 'Add a text or image watermark to every page of a PDF.',
  category: 'pdf',
  presence: 'both',
  keywords: ['watermark', 'pdf', 'stamp', 'overlay', 'text'],

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
  memoryEstimate: 'low',

  defaults: {
    mode: 'text',
    text: 'CONFIDENTIAL',
    opacity: 0.3,
    fontSize: 48,
    rotation: -45,
    color: '#888888',
  },

  Component: WatermarkPdfComponentStub,

  async run(
    inputs: File[],
    params: WatermarkPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const {
      mode = 'text',
      text = 'CONFIDENTIAL',
      imageBuffer,
      imageMime,
      opacity = 0.3,
      fontSize = 48,
      rotation = -45,
      color = '#888888',
    } = params;

    const { PDFDocument, rgb, degrees, StandardFonts } = await import('pdf-lib');

    const input = inputs[0]!;
    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });

    const buffer = await input.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer);
    const pages = pdfDoc.getPages();

    if (mode === 'text') {
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const { r, g, b } = hexToRgb(color);

      for (const page of pages) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        const { width, height } = page.getSize();
        const centerX = width / 2;
        const centerY = height / 2;

        page.drawText(text, {
          x: centerX - (font.widthOfTextAtSize(text, fontSize) / 2),
          y: centerY - fontSize / 2,
          size: fontSize,
          font,
          color: rgb(r, g, b),
          opacity,
          rotate: degrees(rotation),
        });
      }
    } else if (mode === 'image') {
      if (!imageBuffer) {
        throw new Error('imageBuffer is required when mode is "image"');
      }

      let embeddedImage;
      if (imageMime === 'image/png') {
        embeddedImage = await pdfDoc.embedPng(imageBuffer);
      } else {
        embeddedImage = await pdfDoc.embedJpg(imageBuffer);
      }

      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      for (const page of pages) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        const { width, height } = page.getSize();
        const scale = Math.min(width / imgWidth, height / imgHeight) * 0.5;
        const drawW = imgWidth * scale;
        const drawH = imgHeight * scale;

        page.drawImage(embeddedImage, {
          x: (width - drawW) / 2,
          y: (height - drawH) / 2,
          width: drawW,
          height: drawH,
          opacity,
          rotate: degrees(rotation),
        });
      }
    } else {
      throw new Error(`Unknown watermark mode: "${String(mode)}"`);
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving watermarked PDF' });
    const bytes = await pdfDoc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf', 'doc-multipage.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
