// Prompt-based photo editing on Workers AI (FLUX.2 [klein] 4B).
//
// Kept apart from image-gen-models.ts (text-to-image) so either model can be
// swapped without touching the other.
//
// Model contract, from the Cloudflare model page and the 2026-01-15 launch
// changelog for @cf/black-forest-labs/flux-2-klein-4b:
//   - input is multipart form data (prompt, input_image_0..3, width, height,
//     seed, guidance); the binding takes { multipart: { body, contentType } }
//   - steps are fixed at 4
//   - reference images must be no larger than 512x512
//   - width/height range 256-1920
//   - output { image: base64 }
//
// Cost (Cloudflare list price): $0.000059 per input 512x512 tile and
// $0.000287 per output 512x512 tile. We send exactly one reference image of
// at most 512x512 (one input tile) and ask for at most 1024x1024 (four
// output tiles), so one call costs at most ~$0.0012. The cost-model guard in
// functions/_lib/pricing-margin.test.ts derives the worst case from the
// constants below.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export const PHOTO_EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

/** Longest side, in pixels, of the one reference image we accept. */
export const PHOTO_EDIT_MAX_INPUT_SIDE = 512;
/** Longest side, in pixels, of the output we request. */
export const PHOTO_EDIT_MAX_OUTPUT_SIDE = 1024;
/** Model minimum for width and height. */
const MIN_OUTPUT_SIDE = 256;
/** Reference images sent per run. The model allows 4; we send 1. */
export const PHOTO_EDIT_MAX_REFERENCE_IMAGES = 1;
/** Prompt cap. Instructions longer than this add nothing for a 4B model. */
export const PHOTO_EDIT_MAX_PROMPT_CHARS = 1000;

/** Cloudflare list prices for flux-2-klein-4b, per 512x512 tile. */
export const FLUX2_KLEIN_4B_INPUT_TILE_USD = 0.000059;
export const FLUX2_KLEIN_4B_OUTPUT_TILE_USD = 0.000287;

/**
 * Worst-case Cloudflare cost of one photo-edit-pro run, from the caps above.
 * One provider call per run, no retry or fallback.
 */
export function photoEditWorstCaseUsd(): number {
  const tiles = (side: number) => Math.ceil(side / 512) ** 2;
  return (
    PHOTO_EDIT_MAX_REFERENCE_IMAGES *
      tiles(PHOTO_EDIT_MAX_INPUT_SIDE) *
      FLUX2_KLEIN_4B_INPUT_TILE_USD +
    tiles(PHOTO_EDIT_MAX_OUTPUT_SIDE) * FLUX2_KLEIN_4B_OUTPUT_TILE_USD
  );
}

export interface PhotoEditInput {
  /** PNG, JPEG or WebP bytes, at most PHOTO_EDIT_MAX_INPUT_SIDE per side. */
  image: Uint8Array;
  prompt: string;
}

export interface PhotoEditOutput {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Output size for a reference image: same aspect ratio, longest side
 * PHOTO_EDIT_MAX_OUTPUT_SIDE, both sides multiples of 16 within the model's
 * 256 minimum. Never exceeds PHOTO_EDIT_MAX_OUTPUT_SIDE on either side.
 */
export function photoEditOutputSize(input: ImageSize): ImageSize {
  const scale = PHOTO_EDIT_MAX_OUTPUT_SIDE / Math.max(input.width, input.height);
  const side = (n: number) =>
    Math.min(
      PHOTO_EDIT_MAX_OUTPUT_SIDE,
      Math.max(MIN_OUTPUT_SIDE, Math.round((n * scale) / 16) * 16),
    );
  return { width: side(input.width), height: side(input.height) };
}

/**
 * Pixel dimensions read from PNG, JPEG or WebP headers, without decoding.
 * Returns null when the header is missing or malformed.
 */
export function imageDimensions(bytes: Uint8Array): ImageSize | null {
  const at = (i: number) => bytes[i] ?? 0;
  const u16be = (i: number) => (at(i) << 8) | at(i + 1);
  const u32be = (i: number) =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  const valid = (s: ImageSize) => (s.width > 0 && s.height > 0 ? s : null);

  // PNG: signature, then the IHDR chunk carries width and height.
  if (bytes.length >= 24 && at(0) === 0x89 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return valid({ width: u32be(16), height: u32be(20) });
  }

  // JPEG: walk marker segments to the first start-of-frame.
  if (bytes.length >= 4 && at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      const length = u16be(i + 2);
      if (length < 2) return null;
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return valid({ height: u16be(i + 5), width: u16be(i + 7) });
      i += 2 + length;
    }
    return null;
  }

  // WebP: RIFF container with a VP8, VP8L or VP8X first chunk.
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') {
      return valid({
        width: (at(26) | (at(27) << 8)) & 0x3fff,
        height: (at(28) | (at(29) << 8)) & 0x3fff,
      });
    }
    if (chunk === 'VP8L' && at(20) === 0x2f) {
      return valid({
        width: 1 + (at(21) | ((at(22) & 0x3f) << 8)),
        height: 1 + ((at(22) >> 6) | (at(23) << 2) | ((at(24) & 0x0f) << 10)),
      });
    }
    if (chunk === 'VP8X') {
      return valid({
        width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
        height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
      });
    }
  }
  return null;
}

function mimeFor(bytes: Uint8Array): PhotoEditOutput['contentType'] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
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

/**
 * Validate a reference image before any provider work. Throws a
 * user-facing error when it is not a readable PNG/JPEG/WebP within the
 * input cap.
 */
export function checkPhotoEditImage(image: Uint8Array): ImageSize {
  const size = mimeFor(image) ? imageDimensions(image) : null;
  if (!size) throw new Error('Image must be a readable PNG, JPEG, or WebP');
  if (Math.max(size.width, size.height) > PHOTO_EDIT_MAX_INPUT_SIDE)
    throw new Error(`Image must be at most ${PHOTO_EDIT_MAX_INPUT_SIDE}px on its longest side`);
  return size;
}

export async function editPhoto(env: Env, input: PhotoEditInput): Promise<PhotoEditOutput> {
  const size = checkPhotoEditImage(input.image);
  const inputType = mimeFor(input.image)!;
  const out = photoEditOutputSize(size);

  const form = new FormData();
  form.append('prompt', input.prompt);
  form.append(
    'input_image_0',
    new Blob([new Uint8Array(input.image)], { type: inputType }),
    'input',
  );
  form.append('width', String(out.width));
  form.append('height', String(out.height));
  // Serializing through Response generates the multipart boundary header the
  // model needs; a bare "multipart/form-data" content type has no boundary.
  const serialized = new Response(form);
  const contentType = serialized.headers.get('content-type');
  if (!contentType || !serialized.body) throw new Error('Could not encode the photo-edit request');

  const res = (await withTimeout(
    env.AI.run(PHOTO_EDIT_MODEL, {
      multipart: { body: serialized.body, contentType },
    }),
    INFERENCE_TIMEOUTS.image,
    'photo-edit-flux2',
  )) as { image?: unknown } | null;
  if (!res || typeof res.image !== 'string' || res.image.length < 16) {
    throw new Error('Photo-edit model returned no image');
  }
  const outType = mimeFor(decodeHead(res.image));
  if (!outType) throw new Error('Photo-edit model returned an unrecognized image format');
  return { contentType: outType, base64: res.image, width: out.width, height: out.height };
}
