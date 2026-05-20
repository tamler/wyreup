// Vision-model provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signatures (`visionPrompt`, `detectObjects`) are what the rest of the
// code imports, so swaps don't ripple beyond this module.
//
// Current backend: Cloudflare Workers AI. The env.AI binding ships with
// Pages Functions — no token needed.

import type { Env } from '../env';

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DETECTION_MODEL = '@cf/facebook/detr-resnet-50';

export interface DetectedObject {
  score: number;
  label: string;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

// Single-turn vision prompt: one image + one instruction → text.
export async function visionPrompt(
  env: Env,
  imageBytes: Uint8Array,
  prompt: string,
): Promise<string> {
  const res = (await env.AI.run(VISION_MODEL, {
    image: Array.from(imageBytes),
    prompt,
    max_tokens: 1024,
  })) as { response?: string };
  if (!res || typeof res.response !== 'string') {
    throw new Error('Vision model returned no response');
  }
  return res.response.trim();
}

export async function detectObjects(
  env: Env,
  imageBytes: Uint8Array,
): Promise<DetectedObject[]> {
  const res = (await env.AI.run(DETECTION_MODEL, {
    image: Array.from(imageBytes),
  })) as unknown;
  if (!Array.isArray(res)) {
    throw new Error('Detection model returned no array');
  }
  const first = res[0] as Partial<DetectedObject> | undefined;
  if (res.length > 0 && (typeof first?.score !== 'number' || typeof first?.label !== 'string')) {
    throw new Error('Detection model returned unexpected object shape');
  }
  return res as DetectedObject[];
}
