import type { ToolModule, ToolRunContext } from '../../types.js';
import { createCanvas, loadImage } from '../../lib/canvas.js';

export type QrReaderParams = Record<string, never>;

export interface QrPoint {
  x: number;
  y: number;
}

export interface QrReaderResult {
  detected: boolean;
  data?: string;
  location?: {
    topLeft: QrPoint;
    topRight: QrPoint;
    bottomLeft: QrPoint;
    bottomRight: QrPoint;
  };
}

export const defaultQrReaderParams: QrReaderParams = {};

const QrReaderComponentStub = (): unknown => null;

export const qrReader: ToolModule<QrReaderParams> = {
  id: 'qr-reader',
  slug: 'qr-reader',
  name: 'QR Reader',
  description: 'Decode QR codes from images. Returns the embedded data and code location.',
  category: 'inspect',
  presence: 'both',
  keywords: ['qr', 'barcode', 'decode', 'read', 'scan', 'image'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultQrReaderParams,

  Component: QrReaderComponentStub,

  async run(
    inputs: File[],
    _params: QrReaderParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading QR decoder' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const jsQRModule = await import('jsqr');
    // jsqr CJS interop: the function is at .default in some bundlers
    type JsQRFn = (data: Uint8ClampedArray, width: number, height: number) => { data: string; location: { topLeftCorner: QrPoint; topRightCorner: QrPoint; bottomLeftCorner: QrPoint; bottomRightCorner: QrPoint } } | null;
    const jsQRDefault = (jsQRModule as unknown as { default?: unknown }).default;
    const jsQR = (typeof jsQRDefault === 'function' ? jsQRDefault : jsQRModule) as JsQRFn;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Decoding QR code' });

    const file = inputs[0]!;
    const imgBlob = new Blob([await file.arrayBuffer()], { type: file.type });
    const img = await loadImage(imgBlob);

    const canvas = await createCanvas(img.width, img.height);
    const ctx2d = canvas.getContext('2d');
    ctx2d.drawImage(img, 0, 0);

    // Get pixel data — need to extend interface for getImageData
    const imageData = (ctx2d as unknown as {
      getImageData(x: number, y: number, w: number, h: number): {
        data: Uint8ClampedArray;
        width: number;
        height: number;
      };
    }).getImageData(0, 0, canvas.width, canvas.height);

    const code = jsQR(imageData.data, imageData.width, imageData.height);

    let result: QrReaderResult;
    if (code) {
      result = {
        detected: true,
        data: code.data,
        location: {
          topLeft: code.location.topLeftCorner,
          topRight: code.location.topRightCorner,
          bottomLeft: code.location.bottomLeftCorner,
          bottomRight: code.location.bottomRightCorner,
        },
      };
    } else {
      result = { detected: false };
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
