import type { ToolModule, ToolRunContext } from '../../types.js';
import type { FaviconParams } from './types.js';
import { loadImage, createCanvas, canvasToBlob } from '../../lib/canvas.js';

export type { FaviconParams } from './types.js';
export { defaultFaviconParams } from './types.js';

const FaviconComponentStub = (): unknown => null;

const DEFAULT_SIZES = [16, 32, 48, 64, 128, 180, 192, 512];
const ICO_SIZES = [16, 32, 48];

/**
 * Build a minimal multi-image ICO binary from an array of PNG blobs.
 * The blobs must correspond 1:1 to sizes[] in order.
 * ICO format: 6-byte header + 16-byte dir entry per image + raw image data.
 */
async function buildIco(pngBlobs: { size: number; blob: Blob }[]): Promise<Blob> {
  const count = pngBlobs.length;

  // Load raw bytes for each PNG
  const rawBuffers = await Promise.all(
    pngBlobs.map(({ blob }) => blob.arrayBuffer()),
  );

  // ICO header: reserved(2) + type(2) = 1 for ICO + count(2)
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * count;
  const dataOffset = headerSize + dirSize;

  const totalSize = dataOffset + rawBuffers.reduce((sum, b) => sum + b.byteLength, 0);
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // Header
  view.setUint16(0, 0, true);       // reserved
  view.setUint16(2, 1, true);       // type: 1 = ICO
  view.setUint16(4, count, true);   // image count

  // Directory entries + track running offset into data section
  let dataPos = dataOffset;
  for (let i = 0; i < count; i++) {
    const { size } = pngBlobs[i]!;
    const raw = rawBuffers[i]!;
    const offset = headerSize + i * dirEntrySize;

    // Width/height: 0 means 256 in the ICO spec; for <=255 use actual value
    view.setUint8(offset, size >= 256 ? 0 : size);
    view.setUint8(offset + 1, size >= 256 ? 0 : size);
    view.setUint8(offset + 2, 0);       // color count
    view.setUint8(offset + 3, 0);       // reserved
    view.setUint16(offset + 4, 0, true);  // planes (0 for ICO)
    view.setUint16(offset + 6, 0, true);  // bit count (0 = auto)
    view.setUint32(offset + 8, raw.byteLength, true);  // data size
    view.setUint32(offset + 12, dataPos, true);         // data offset

    dataPos += raw.byteLength;
  }

  // Copy raw PNG data
  const bytes = new Uint8Array(buf);
  let writePos = dataOffset;
  for (const raw of rawBuffers) {
    bytes.set(new Uint8Array(raw), writePos);
    writePos += raw.byteLength;
  }

  return new Blob([buf], { type: 'image/x-icon' });
}

export const favicon: ToolModule<FaviconParams> = {
  id: 'favicon',
  slug: 'favicon',
  name: 'Favicon Generator',
  description: 'Generate a complete favicon set (PNG sizes + ICO + webmanifest) from any image.',
  category: 'create',
  presence: 'both',
  keywords: ['favicon', 'icon', 'ico', 'png', 'webmanifest', 'pwa'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/zip',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: {
    sizes: [16, 32, 48, 64, 128, 180, 192, 512],
    includeIco: true,
  },

  Component: FaviconComponentStub,

  async run(
    inputs: File[],
    params: FaviconParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const sizes = params.sizes ?? DEFAULT_SIZES;
    const includeIco = params.includeIco !== false;

    ctx.onProgress({ stage: 'processing', percent: 5, message: 'Loading image' });

    const input = inputs[0]!;
    const sourceImage = await loadImage(input);
    const srcW = sourceImage.width;
    const srcH = sourceImage.height;

    // Determine crop to make it square (center-crop the longer side)
    const minDim = Math.min(srcW, srcH);
    const cropX = (srcW - minDim) / 2;
    const cropY = (srcH - minDim) / 2;

    const pngBlobs: Map<number, Blob> = new Map();

    for (let i = 0; i < sizes.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const size = sizes[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor(10 + (i / sizes.length) * 60),
        message: `Generating ${size}x${size}`,
      });

      const canvas = await createCanvas(size, size);
      const ctx2d = canvas.getContext('2d');
      // Draw with center-crop: use 9-arg drawImage to source from the square crop
      ctx2d.drawImage(sourceImage, cropX, cropY, minDim, minDim, 0, 0, size, size);
      const blob = await canvasToBlob(canvas, 'image/png');
      pngBlobs.set(size, blob);
    }

    ctx.onProgress({ stage: 'processing', percent: 75, message: 'Building ZIP' });

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (const [size, blob] of pngBlobs) {
      const buf = await blob.arrayBuffer();
      zip.file(`favicon-${size}.png`, buf);
    }

    if (includeIco) {
      ctx.onProgress({ stage: 'processing', percent: 80, message: 'Building ICO' });
      const icoEntries = ICO_SIZES.filter((s) => pngBlobs.has(s)).map((s) => ({
        size: s,
        blob: pngBlobs.get(s)!,
      }));
      if (icoEntries.length > 0) {
        const icoBlob = await buildIco(icoEntries);
        zip.file('favicon.ico', await icoBlob.arrayBuffer());
      }
    }

    // site.webmanifest referencing 192 and 512
    const manifestIcons = [192, 512]
      .filter((s) => pngBlobs.has(s))
      .map((s) => ({
        src: `favicon-${s}.png`,
        sizes: `${s}x${s}`,
        type: 'image/png',
      }));
    const manifest = JSON.stringify({ icons: manifestIcons }, null, 2);
    zip.file('site.webmanifest', manifest);

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Compressing ZIP' });

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([zipBuffer], { type: 'application/zip' });
  },

  __testFixtures: {
    valid: ['graphic.png'],
    weird: [],
    expectedOutputMime: ['application/zip'],
  },
};
