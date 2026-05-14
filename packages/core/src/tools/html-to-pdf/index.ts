import type { ToolModule, ToolRunContext } from '../../types.js';

export interface HtmlToPdfParams {
  pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal';
  orientation?: 'portrait' | 'landscape';
  margin?: number;
  scale?: number;
}

/**
 * Page dimensions in mm [width, height] for portrait orientation.
 */
const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};

export const htmlToPdf: ToolModule<HtmlToPdfParams> = {
  id: 'html-to-pdf',
  slug: 'html-to-pdf',
  name: 'HTML to PDF',
  description:
    'Convert an HTML file to a PDF document. Renders in the browser using html2canvas and jsPDF.',
  category: 'convert',
  keywords: ['html', 'pdf', 'convert', 'document', 'print', 'web', 'page'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: {
    pageSize: 'A4',
    orientation: 'portrait',
    margin: 10,
    scale: 1.0,
  },

  paramSchema: {
    pageSize: {
      type: 'enum',
      label: 'Page size',
      options: [
        { value: 'A4', label: 'A4 (210 x 297 mm)' },
        { value: 'A3', label: 'A3 (297 x 420 mm)' },
        { value: 'Letter', label: 'Letter (8.5 x 11 in)' },
        { value: 'Legal', label: 'Legal (8.5 x 14 in)' },
      ],
    },
    orientation: {
      type: 'enum',
      label: 'Orientation',
      options: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
    },
    margin: {
      type: 'range',
      label: 'Margin',
      min: 0,
      max: 50,
      step: 1,
      unit: 'mm',
    },
    scale: {
      type: 'range',
      label: 'Scale',
      min: 0.5,
      max: 2.0,
      step: 0.1,
    },
  },

  async run(
    inputs: File[],
    params: HtmlToPdfParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    // html2canvas requires a browser DOM — this tool is browser-only.
    // In Node (test/CI) we throw a clear error rather than silently producing garbage.
    if (typeof document === 'undefined') {
      throw new Error(
        'html-to-pdf requires a browser environment (html2canvas needs a DOM). ' +
          'Run this tool in Chrome, Firefox, or Safari.',
      );
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 5, message: 'Loading renderer' });

    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);

    if (ctx.signal.aborted) throw new Error('Aborted');

    const htmlText = await inputs[0]!.text();

    const pageSize = params.pageSize ?? 'A4';
    const orientation = params.orientation ?? 'portrait';
    const margin = params.margin ?? 10;
    const scale = params.scale ?? 1.0;

    const [pw, ph] = PAGE_SIZES[pageSize] ?? PAGE_SIZES['A4']!;
    const [pageW, pageH] =
      orientation === 'landscape' ? [ph, pw] : [pw, ph];

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Rendering HTML' });

    // Render inside a hidden iframe so the source HTML doesn't pollute the host page
    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;visibility:hidden';
    document.body.appendChild(iframe);

    try {
      const iDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
      if (!iDoc) throw new Error('Cannot access iframe document');

      iDoc.open();
      iDoc.write(htmlText);
      iDoc.close();

      // Wait for images / fonts to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({ stage: 'processing', percent: 40, message: 'Capturing canvas' });

      const canvas = await html2canvas(iDoc.body, {
        scale: scale * 2, // 2x for retina sharpness
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Building PDF' });

      // jsPDF dimensions are in mm by default
      const doc = new jsPDF({
        orientation,
        unit: 'mm',
        format: [pageW, pageH],
      });

      const availW = pageW - 2 * margin;
      const availH = pageH - 2 * margin;

      const imgRatio = canvas.width / canvas.height;
      const pageRatio = availW / availH;

      let drawW: number;
      let drawH: number;
      if (imgRatio > pageRatio) {
        drawW = availW;
        drawH = availW / imgRatio;
      } else {
        drawH = availH;
        drawW = availH * imgRatio;
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      doc.addImage(imgData, 'JPEG', margin, margin, drawW, drawH);

      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

      const pdfBytes = doc.output('arraybuffer');
      return new Blob([pdfBytes], { type: 'application/pdf' });
    } finally {
      document.body.removeChild(iframe);
    }
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
