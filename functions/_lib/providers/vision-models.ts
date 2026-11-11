// Vision-model provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signature (`visionPrompt`) is what the rest of the code imports, so
// swaps don't ripple beyond this module.
//
// Current backend: Cloudflare Workers AI. The env.AI binding ships with
// Pages Functions, no token needed. (detect-objects and its DETR model
// were removed on 2026-11-11: no published price, so cost was unbounded.)

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS, MAX_TOKENS } from '../timeout';

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// Single-turn vision prompt: one image + one instruction → text.
export async function visionPrompt(
  env: Env,
  imageBytes: Uint8Array,
  prompt: string,
): Promise<string> {
  const res = (await withTimeout(
    env.AI.run(VISION_MODEL, {
      image: Array.from(imageBytes),
      prompt,
      max_tokens: MAX_TOKENS.vision,
    }),
    INFERENCE_TIMEOUTS.vision,
    'vision-model',
  )) as { response?: string };
  if (!res || typeof res.response !== 'string') {
    throw new Error('Vision model returned no response');
  }
  return res.response.trim();
}
