import type { ToolModule, ToolRunContext } from '../../types.js';

export interface BarcodeParams {
  data: string;
  format?: 'code128' | 'code39' | 'ean13' | 'ean8' | 'upc' | 'itf' | 'msi';
  outputFormat?: 'png' | 'svg';
  width?: number;
  height?: number;
  displayValue?: boolean;
  foregroundColor?: string;
  backgroundColor?: string;
}

const BarcodeComponentStub = (): unknown => null;

/**
 * Build an SVG string from a JsBarcode encoding object.
 * Works in both Node and browser — no canvas required for SVG output.
 */
function buildSvg(
  data: string,
  text: string,
  options: {
    width: number;
    height: number;
    barWidth: number;
    displayValue: boolean;
    foreground: string;
    background: string;
    margin: number;
    fontSize: number;
  },
): string {
  const bars = data.split('').map((c) => c === '1');
  const { barWidth, height, displayValue, foreground, background, margin, fontSize } = options;

  const barAreaW = bars.length * barWidth;
  const textH = displayValue ? fontSize + 4 : 0;
  const totalW = barAreaW + 2 * margin;
  const totalH = height + textH + 2 * margin;

  const rects: string[] = [];
  let i = 0;
  while (i < bars.length) {
    if (!bars[i]) { i++; continue; }
    let len = 0;
    while (i + len < bars.length && bars[i + len]) len++;
    const x = margin + i * barWidth;
    const y = margin;
    rects.push(`<rect x="${x}" y="${y}" width="${len * barWidth}" height="${height}" fill="${foreground}"/>`);
    i += len;
  }

  const textEl = displayValue
    ? `<text x="${totalW / 2}" y="${margin + height + fontSize}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="${foreground}">${escapeXml(text)}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">`,
    `<rect width="${totalW}" height="${totalH}" fill="${background}"/>`,
    ...rects,
    textEl,
    `</svg>`,
  ].join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert JsBarcode format slug to the string accepted by the library. */
function toJsbFormat(fmt: string): string {
  const map: Record<string, string> = {
    code128: 'CODE128',
    code39: 'CODE39',
    ean13: 'EAN13',
    ean8: 'EAN8',
    upc: 'UPC',
    itf: 'ITF14',
    msi: 'MSI',
  };
  return map[fmt] ?? 'CODE128';
}

export const barcode: ToolModule<BarcodeParams> = {
  id: 'barcode',
  slug: 'barcode',
  name: 'Barcode Generator',
  description:
    'Generate barcode images from text or numbers. Supports Code 128, Code 39, EAN, UPC, ITF, and MSI formats.',
  category: 'create',
  presence: 'both',
  keywords: [
    'barcode',
    'code128',
    'ean',
    'upc',
    'isbn',
    'generate',
    'scan',
    'label',
    'product',
    'retail',
  ],

  input: {
    accept: [],
    min: 0,
    max: 0,
    sizeLimit: 0,
  },
  output: {
    mime: 'image/svg+xml',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    data: '',
    format: 'code128',
    outputFormat: 'svg',
    width: 400,
    height: 100,
    displayValue: true,
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
  },

  paramSchema: {
    data: {
      type: 'string',
      label: 'Barcode data',
      placeholder: '123456789',
    },
    format: {
      type: 'enum',
      label: 'Format',
      options: [
        { value: 'code128', label: 'Code 128 (general purpose)' },
        { value: 'code39', label: 'Code 39 (alphanumeric)' },
        { value: 'ean13', label: 'EAN-13 (13 digits)' },
        { value: 'ean8', label: 'EAN-8 (8 digits)' },
        { value: 'upc', label: 'UPC-A (12 digits)' },
        { value: 'itf', label: 'ITF-14 (14 digits)' },
        { value: 'msi', label: 'MSI (numeric)' },
      ],
    },
    outputFormat: {
      type: 'enum',
      label: 'Output format',
      options: [
        { value: 'svg', label: 'SVG (scalable)' },
        { value: 'png', label: 'PNG (raster, browser only)' },
      ],
    },
    width: {
      type: 'range',
      label: 'Width',
      min: 100,
      max: 1000,
      step: 10,
      unit: 'px',
    },
    height: {
      type: 'range',
      label: 'Bar height',
      min: 30,
      max: 300,
      step: 5,
      unit: 'px',
    },
    displayValue: {
      type: 'boolean',
      label: 'Show value',
      help: 'Display the encoded value below the barcode.',
    },
    foregroundColor: {
      type: 'string',
      label: 'Bar color',
      placeholder: '#000000',
    },
    backgroundColor: {
      type: 'string',
      label: 'Background color',
      placeholder: '#FFFFFF',
    },
  },

  Component: BarcodeComponentStub,

  async run(
    _inputs: File[],
    params: BarcodeParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const data = (params.data ?? '').trim();
    if (!data) throw new Error('data is required and must not be empty');

    const format = params.format ?? 'code128';
    const outputFormat = params.outputFormat ?? 'svg';
    const targetWidth = params.width ?? 400;
    const height = params.height ?? 100;
    const displayValue = params.displayValue !== false;
    const foreground = params.foregroundColor ?? '#000000';
    const background = params.backgroundColor ?? '#FFFFFF';

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Encoding barcode' });

    const jsbModule = await import('jsbarcode');
    // jsbarcode exports vary by bundler — normalise to the callable function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const jsbFn = (((jsbModule as any).default as unknown) ?? jsbModule) as (target: object, data: string, opts: object) => void;

    // Use the object renderer to get raw encoding data
    const obj: { encodings?: { data: string; text: string; options: Record<string, unknown> }[] } = {};
    jsbFn(obj, data, {
      format: toJsbFormat(format),
      width: 2,
      height,
      displayValue,
      lineColor: foreground,
      background,
      margin: 10,
      fontSize: 20,
    });

    if (!obj.encodings || obj.encodings.length === 0) {
      throw new Error(`Failed to encode barcode data for format ${format}`);
    }

    const enc = obj.encodings[0]!;

    // Calculate bar width to reach target total width
    const margin = 10;
    const barCount = enc.data.length;
    const barWidth = Math.max(1, Math.floor((targetWidth - 2 * margin) / barCount));

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Building SVG' });

    const svgStr = buildSvg(enc.data, enc.text, {
      width: targetWidth,
      height,
      barWidth,
      displayValue,
      foreground,
      background,
      margin,
      fontSize: 20,
    });

    if (outputFormat === 'svg') {
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return new Blob([svgStr], { type: 'image/svg+xml' });
    }

    // PNG output — requires browser Canvas API
    if (typeof document === 'undefined') {
      throw new Error(
        'PNG output requires a browser environment. Use SVG format in Node/CLI.',
      );
    }

    ctx.onProgress({ stage: 'encoding', percent: 70, message: 'Rendering PNG' });

    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const canvasCtx = canvas.getContext('2d');
        if (!canvasCtx) { reject(new Error('Canvas 2D not available')); return; }
        canvasCtx.drawImage(img, 0, 0);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
      img.src = url;
    });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return pngBlob;
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/svg+xml'],
  },
};
