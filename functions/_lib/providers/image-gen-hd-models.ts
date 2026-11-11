// HD text-to-image on Workers AI (FLUX.2 [klein] 9B).
//
// Kept apart from image-gen-models.ts (Flux Schnell, the 1-credit tool) so
// either model can be swapped without touching the other.
//
// Model contract, from the Cloudflare model page and the 2026-01-28 launch
// changelog for @cf/black-forest-labs/flux-2-klein-9b:
//   - input is multipart form data, even for a prompt alone; the binding
//     takes { multipart: { body, contentType } }
//   - steps are fixed at 4 (distilled model)
//   - width/height range 256-1920
//   - output { image: base64 }
//   - partner model, Black Forest Labs terms: https://bfl.ai/legal/terms-of-service
//
// Cost (Cloudflare list price): $0.015 for the first output megapixel,
// $0.002 per extra output megapixel, $0.002 per input image megapixel.
// We send no input images, and every size below is at most 1,000,000
// pixels, so one call stays inside the first megapixel even if Cloudflare
// counts a megapixel as 10^6 pixels rather than 2^20. One call costs at
// most $0.015. The runner makes exactly one call per run: no retry and no
// fallback model. The cost-model guard in functions/_lib/pricing-margin.test.ts
// derives the worst case from the constants below.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export const IMAGE_GEN_HD_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';

/** Output sizes we offer. Sides are multiples of 16; every area is <= 1,000,000 px. */
export const IMAGE_GEN_HD_SIZES = {
  square: { width: 992, height: 992 },
  landscape: { width: 1152, height: 864 },
  portrait: { width: 864, height: 1152 },
  wide: { width: 1328, height: 752 },
} as const;

export type ImageGenHdAspect = keyof typeof IMAGE_GEN_HD_SIZES;

/** Hard pixel ceiling per output, one Cloudflare-billed megapixel. */
export const IMAGE_GEN_HD_MAX_OUTPUT_PIXELS = 1_000_000;
/** Input images sent per run. The model allows 4; this tool sends none. */
export const IMAGE_GEN_HD_INPUT_IMAGES = 0;
/** Model calls per run, including any retry or fallback. */
export const IMAGE_GEN_HD_CALLS_PER_RUN = 1;
/** Prompt cap. Price does not depend on prompt length; this keeps requests sane. */
export const IMAGE_GEN_HD_MAX_PROMPT_CHARS = 2000;

export const IMAGE_GEN_HD_PRICE_FIRST_MP_USD = 0.015;
export const IMAGE_GEN_HD_PRICE_EXTRA_MP_USD = 0.002;
export const IMAGE_GEN_HD_PRICE_INPUT_MP_USD = 0.002;

export interface ImageGenHdInput {
  prompt: string;
  aspect: ImageGenHdAspect;
}

export interface ImageGenHdOutput {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  width: number;
  height: number;
}

export function isImageGenHdAspect(value: unknown): value is ImageGenHdAspect {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(IMAGE_GEN_HD_SIZES, value)
  );
}

function mimeFor(head: Uint8Array): ImageGenHdOutput['contentType'] | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (
    head.length >= 12 &&
    String.fromCharCode(...head.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...head.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function decodeHead(b64: string): Uint8Array {
  // 16 base64 chars = 12 bytes, enough to identify the format.
  let head: string;
  try {
    head = atob(b64.slice(0, 16));
  } catch {
    return new Uint8Array();
  }
  const out = new Uint8Array(head.length);
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
  return out;
}

export async function generateImageHd(env: Env, input: ImageGenHdInput): Promise<ImageGenHdOutput> {
  const size = IMAGE_GEN_HD_SIZES[input.aspect];
  const form = new FormData();
  form.append('prompt', input.prompt);
  form.append('width', String(size.width));
  form.append('height', String(size.height));
  // Serializing through Response generates the multipart boundary header the
  // model needs; a bare "multipart/form-data" content type has no boundary.
  const serialized = new Response(form);
  const contentType = serialized.headers.get('content-type');
  if (!contentType || !serialized.body) throw new Error('Could not encode the image request');

  const res = (await withTimeout(
    env.AI.run(IMAGE_GEN_HD_MODEL, {
      multipart: { body: serialized.body, contentType },
    }),
    INFERENCE_TIMEOUTS.image,
    'image-gen-hd-flux2',
  )) as { image?: unknown } | null;
  if (!res || typeof res.image !== 'string' || res.image.length < 16) {
    throw new Error('HD image model returned no image');
  }
  const outType = mimeFor(decodeHead(res.image));
  if (!outType) throw new Error('HD image model returned an unrecognized image format');
  return { contentType: outType, base64: res.image, width: size.width, height: size.height };
}
