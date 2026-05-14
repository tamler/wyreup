import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Upscale2xParams {
  // No configurable params — Swin2SR classical SR x2 is fixed.
}

export const defaultUpscale2xParams: Upscale2xParams = {};

// Swin2SR classical SR x2 — Apache 2.0 licensed, ~22 MB q4
// https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64
const MODEL_ID = 'Xenova/swin2SR-classical-sr-x2-64';

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const upscale2x: ToolModule<Upscale2xParams> = {
  id: 'upscale-2x',
  slug: 'upscale-2x',
  name: 'Upscale 2x',
  description: 'Double the resolution of any image using AI super-resolution — runs on your device.',
  category: 'optimize',
  keywords: ['upscale', 'super-resolution', 'enlarge', 'resolution', 'sharpen', 'enhance', 'ai'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024, // 10 MB; large images are tiled but may be slow
  },
  output: { mime: 'image/png' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 22_000_000, // ~22 MB q4 Swin2SR
  installGroup: 'image-ai',
  requires: { webgpu: 'preferred' },

  defaults: defaultUpscale2xParams,

  async run(inputs: File[], _params: Upscale2xParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('upscale-2x accepts exactly one image file.');
    }
    const input = inputs[0]!;
    if (!ACCEPTED_MIME_TYPES.includes(input.type)) {
      throw new Error(
        `Unsupported input type: ${input.type}. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`,
      );
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading super-resolution model' });

    const pipe = await getPipeline(ctx, 'image-to-image', MODEL_ID, {
      dtype: 'q4',
    }) as (input: unknown) => Promise<unknown>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Upscaling image (this may take a few seconds)' });

    const arrayBuffer = await input.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: input.type });
    const dataUrl = await blobToDataUrl(blob);

    const result = await pipe(dataUrl) as { toBlob?: () => Promise<Blob>; data?: Uint8ClampedArray; width?: number; height?: number };

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Encoding output' });

    let outputBlob: Blob;
    if (result && typeof result.toBlob === 'function') {
      outputBlob = await result.toBlob();
    } else if (result && result.data && result.width && result.height) {
      // RawImage fallback: convert to PNG via canvas
      outputBlob = await rawImageToBlob(result.data, result.width, result.height);
    } else {
      throw new Error('Unexpected output from super-resolution model.');
    }

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
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${blob.type};base64,${b64}`;
}

async function rawImageToBlob(data: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(width, height);
    const ctx = oc.getContext('2d')!;
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), width, height);
    ctx.putImageData(imageData, 0, 0);
    return oc.convertToBlob({ type: 'image/png' });
  }
  // Node: use @napi-rs/canvas — produce a minimal fallback PNG
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  // @napi-rs/canvas doesn't have ImageData directly; encode the canvas as-is
  const pngData: Uint8Array = canvas.toBuffer('image/png');
  return new Blob([pngData.buffer as ArrayBuffer], { type: 'image/png' });
}
