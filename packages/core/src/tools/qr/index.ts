import type { ToolModule, ToolRunContext } from '../../types.js';
import type { QrParams } from './types.js';

export type { QrParams } from './types.js';
export { defaultQrParams } from './types.js';

// Note: qr-code-styling requires the `canvas` native npm package which is
// not available in this environment. This tool uses the `qrcode` library
// instead (MIT, pure JS, generates PNG directly in Node). Logo embedding
// is not supported; that can be added later with a canvas-compatible setup.

const QrComponentStub = (): unknown => null;

export const qr: ToolModule<QrParams> = {
  id: 'qr',
  slug: 'qr',
  name: 'QR Code',
  description: 'Generate a QR code image from text or a URL.',
  category: 'create',
  presence: 'both',
  keywords: ['qr', 'qrcode', 'barcode', 'generate', 'url', 'link'],

  input: {
    accept: [],
    min: 0,
    max: 0,
    sizeLimit: 0,
  },
  output: {
    mime: 'image/png',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    text: '',
    size: 300,
    foregroundColor: '#000000',
    backgroundColor: '#ffffff',
    errorCorrectionLevel: 'M',
  },

  paramSchema: {
    text: {
      type: 'string',
      label: 'text',
      placeholder: 'https://example.com',
    },
    size: {
      type: 'range',
      label: 'size',
      min: 100,
      max: 1000,
      step: 50,
      unit: 'px',
    },
    errorCorrectionLevel: {
      type: 'enum',
      label: 'error correction',
      help: 'Higher levels can recover from more damage but increase QR complexity.',
      options: [
        { value: 'L', label: 'L — 7%' },
        { value: 'M', label: 'M — 15%' },
        { value: 'Q', label: 'Q — 25%' },
        { value: 'H', label: 'H — 30%' },
      ],
    },
  },

  Component: QrComponentStub,

  async run(
    _inputs: File[],
    params: QrParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const {
      text,
      size = 300,
      foregroundColor = '#000000',
      backgroundColor = '#ffffff',
      errorCorrectionLevel = 'M',
    } = params;

    if (!text || text.trim() === '') {
      throw new Error('text is required and must not be empty');
    }

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Generating QR code' });

    const QRCode = await import('qrcode');

    const buffer: Buffer = await QRCode.toBuffer(text, {
      errorCorrectionLevel,
      width: size,
      color: {
        dark: foregroundColor,
        light: backgroundColor,
      },
    });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    // Copy to a plain ArrayBuffer to satisfy BlobPart type constraints
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    return new Blob([arrayBuffer], { type: 'image/png' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};
