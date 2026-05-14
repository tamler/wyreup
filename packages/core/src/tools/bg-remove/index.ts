import type { ToolModule, ToolRunContext } from '../../types.js';
import { createCanvas, loadImage, canvasToBlob } from '../../lib/canvas.js';
import { getPipeline } from '../../lib/transformers.js';

export interface BgRemoveParams {
  outputFormat?: 'png' | 'webp';
}

export const defaultBgRemoveParams: BgRemoveParams = {
  outputFormat: 'png',
};

// BiRefNet_lite — MIT licensed, ~100 MB fp16
// https://huggingface.co/onnx-community/BiRefNet_lite-ONNX
// RMBG-1.4 and RMBG-2.0 are CC-BY-NC 4.0 — rejected.
const MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX';

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const bgRemove: ToolModule<BgRemoveParams> = {
  id: 'bg-remove',
  slug: 'bg-remove',
  name: 'Remove Background',
  description: 'Strip the background from any photo — runs entirely on your device.',
  category: 'privacy',
  keywords: ['background', 'remove', 'transparent', 'cut-out', 'composite', 'alpha', 'png'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    max: 1,
    sizeLimit: 20 * 1024 * 1024, // 20 MB; capped to avoid OOM at 512x512 inference
  },
  output: { mime: 'image/png' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 100_000_000, // ~100 MB fp16 BiRefNet_lite
  installGroup: 'image-ai',
  requires: { webgpu: 'preferred' },

  defaults: defaultBgRemoveParams,

  async run(inputs: File[], params: BgRemoveParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('bg-remove accepts exactly one image file.');
    }
    const input = inputs[0]!;
    if (!ACCEPTED_MIME_TYPES.includes(input.type)) {
      throw new Error(
        `Unsupported input type: ${input.type}. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`,
      );
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading background removal model' });

    // BiRefNet_lite uses image-segmentation pipeline
    const pipe = await getPipeline(ctx, 'image-segmentation', MODEL_ID, {
      dtype: 'fp16',
    }) as (input: unknown) => Promise<Array<{ label: string; mask: unknown }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Removing background' });

    // Load image as data URL for the pipeline
    const arrayBuffer = await input.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: input.type });
    const dataUrl = await blobToDataUrl(blob);

    const result = await pipe(dataUrl);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Compositing transparent output' });

    // The pipeline returns segmentation masks. We use the first mask (the foreground/subject).
    // BiRefNet returns a single mask for the salient object.
    const img = await loadImage(input);
    const canvas = await createCanvas(img.width, img.height);
    const context = canvas.getContext('2d') as unknown as {
      drawImage(src: unknown, x: number, y: number): void;
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
      putImageData(data: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void;
    };

    context.drawImage(img as unknown, 0, 0);

    // Extract RGBA pixel data and apply mask as alpha channel
    const imageData = context.getImageData(0, 0, img.width, img.height);
    const pixels = imageData.data;

    // The mask from BiRefNet is a grayscale image. We decode it from the result.
    // Transformers.js image-segmentation returns masks as RawImage objects.
    if (result && result.length > 0) {
      const segResult = result[0] as { mask?: { data?: Uint8ClampedArray | number[]; width?: number; height?: number } };
      const mask = segResult.mask;
      if (mask && mask.data) {
        const maskData = mask.data;
        // mask.data is grayscale (1 channel) or RGBA. We treat it as grayscale alpha.
        const maskStride = maskData.length / (img.width * img.height);
        for (let i = 0; i < img.width * img.height; i++) {
          // Use first channel value as alpha
          const maskVal = maskStride >= 4 ? (maskData[i * maskStride]! + maskData[i * maskStride + 1]! + maskData[i * maskStride + 2]!) / 3 : maskData[i * maskStride] ?? 0;
          pixels[i * 4 + 3] = Math.round(maskVal);
        }
      }
    }

    const ctx2d = canvas.getContext('2d') as unknown as {
      putImageData(data: ImageData | { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void;
    };
    ctx2d.putImageData(imageData as ImageData, 0, 0);

    const outputMime = params.outputFormat === 'webp' ? 'image/webp' : 'image/png';
    const outputBlob = await canvasToBlob(canvas, outputMime);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [outputBlob];
  },

  __testFixtures: {
    valid: ['photo.jpg'],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  // Node fallback: base64 encode
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${blob.type};base64,${b64}`;
}
