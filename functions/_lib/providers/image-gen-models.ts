// Image-generation provider wrapper.
//
// Distinct from image-models.ts (which talks to Replicate for bg-remove
// and upscale). This file owns text-to-image on Workers AI — keeps the
// vendor swap surgical when we later split image-gen onto its own infra.
//
// Current backend: Cloudflare Workers AI (flux-1-schnell). The env.AI
// binding ships with Pages Functions — no token needed.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

const FLUX_SCHNELL_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export interface ImageGenInput {
  prompt: string;
  /** Default 4 (schnell). Raising it eats margin; cap server-side. */
  steps?: number;
}

export interface ImageGenOutput {
  /** Output MIME — always image/jpeg from schnell. */
  contentType: 'image/jpeg';
  /** Base64-encoded JPEG bytes. */
  base64: string;
}

// Hard cap on steps to keep cost predictable. Schnell's quality plateaus
// past 4 steps anyway.
const MAX_STEPS = 8;

export async function generateImage(
  env: Env,
  input: ImageGenInput,
): Promise<ImageGenOutput> {
  const steps = Math.min(Math.max(input.steps ?? 4, 1), MAX_STEPS);
  const res = (await withTimeout(
    env.AI.run(FLUX_SCHNELL_MODEL, {
      prompt: input.prompt,
      steps,
    }),
    INFERENCE_TIMEOUTS.image,
    'image-gen-flux',
  )) as { image?: string };
  if (!res || typeof res.image !== 'string') {
    throw new Error('Image-gen model returned no image');
  }
  return { contentType: 'image/jpeg', base64: res.image };
}
