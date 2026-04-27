import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ImageToPdfParams } from './types.js';

export type { ImageToPdfParams } from './types.js';
export { defaultImageToPdfParams } from './types.js';

const ImageToPdfComponentStub = (): unknown => null;

export const imageToPdf: ToolModule<ImageToPdfParams> = {
  id: 'image-to-pdf',
  slug: 'image-to-pdf',
  name: 'Images → PDF',
  description: 'Combine one or more images into a single PDF document.',
  category: 'export',
  presence: 'both',
  keywords: ['pdf', 'image', 'combine', 'document', 'jpg', 'png'],

  input: {
    accept: ['image/jpeg', 'image/jpg', 'image/png'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { pageSize: 'auto', margin: 36 },

  paramSchema: {
    pageSize: {
      type: 'enum',
      label: 'page size',
      help: '"Auto" sizes each page to its image. A4 / Letter letterbox the image inside the chosen page.',
      options: [
        { value: 'auto', label: 'auto (fit to image)' },
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
      ],
    },
    margin: {
      type: 'range',
      label: 'margin',
      help: '1 pt = 1/72 in. Ignored for "auto" page size.',
      min: 0,
      max: 144,
      step: 1,
      unit: 'pt',
      showWhen: { field: 'pageSize', in: ['a4', 'letter'] },
    },
  },

  Component: ImageToPdfComponentStub,

  async run(
    inputs: File[],
    params: ImageToPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    // Dynamic import so pdf-lib only loads when this tool runs.
    const { PDFDocument } = await import('pdf-lib');

    const pageSize = params.pageSize ?? 'auto';
    const margin = params.margin ?? 36;

    const doc = await PDFDocument.create();

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      const mime = input.type.toLowerCase();

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Embedding ${input.name} (${i + 1}/${inputs.length})`,
      });

      const buffer = await input.arrayBuffer();
      let image;
      if (mime === 'image/jpeg' || mime === 'image/jpg') {
        image = await doc.embedJpg(buffer);
      } else if (mime === 'image/png') {
        image = await doc.embedPng(buffer);
      } else {
        throw new Error(
          `Unsupported input format "${input.type}". image-to-pdf accepts image/jpeg and image/png.`,
        );
      }

      let pageWidth: number;
      let pageHeight: number;
      let drawX = 0;
      let drawY = 0;
      let drawWidth = image.width;
      let drawHeight = image.height;

      if (pageSize === 'a4') {
        pageWidth = 595;
        pageHeight = 842;
        const available = { w: pageWidth - 2 * margin, h: pageHeight - 2 * margin };
        const scale = Math.min(available.w / image.width, available.h / image.height, 1);
        drawWidth = image.width * scale;
        drawHeight = image.height * scale;
        drawX = (pageWidth - drawWidth) / 2;
        drawY = (pageHeight - drawHeight) / 2;
      } else if (pageSize === 'letter') {
        pageWidth = 612;
        pageHeight = 792;
        const available = { w: pageWidth - 2 * margin, h: pageHeight - 2 * margin };
        const scale = Math.min(available.w / image.width, available.h / image.height, 1);
        drawWidth = image.width * scale;
        drawHeight = image.height * scale;
        drawX = (pageWidth - drawWidth) / 2;
        drawY = (pageHeight - drawHeight) / 2;
      } else {
        // 'auto' — page matches image dimensions
        pageWidth = image.width;
        pageHeight = image.height;
      }

      const page = doc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
    const bytes = await doc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['application/pdf'],
  },
};
