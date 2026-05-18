// Image-model provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signature (`runBgRemove`, `runUpscale`) is what the rest of the code
// imports, so swaps don't ripple beyond this module.
//
// Token comes from env.IMAGE_MODEL_TOKEN. Add/rename per the new vendor's
// auth scheme but keep the variable name generic so the rest of the
// codebase, wrangler.toml, and the secret-set commands don't change.

import type { Env } from '../env';

export interface BgRemoveInput {
  /** https URL or data: URL. */
  image: string;
}
export interface UpscaleInput {
  image: string;
  /** 2 (default) or 4. */
  scale?: 2 | 4;
}
export interface ImageOutput {
  /** Output MIME (image/png most often). */
  contentType: string;
  /** Base64-encoded image bytes. Client decodes back to a Blob.
   *  We don't return the provider URL directly because CSP locks
   *  connect-src to self + models.wyreup.com — the client can't
   *  fetch from a third-party CDN. Proxying through the response
   *  adds ~33% overhead but keeps the vendor name out of the CSP. */
  base64: string;
  scale?: number;
}

// ─── Current backend: Replicate ─────────────────────────────────────────
// To swap providers: replace the bodies below and the constants at top.
// The exported function signatures must stay the same.

const BG_REMOVE_MODEL = '851-labs/background-remover';
const UPSCALE_MODEL = 'nightmareai/real-esrgan';

export async function runBgRemove(input: BgRemoveInput, env: Env): Promise<ImageOutput> {
  const url = await runPrediction(env, BG_REMOVE_MODEL, { image: input.image });
  return fetchAsBase64(url);
}

export async function runUpscale(input: UpscaleInput, env: Env): Promise<ImageOutput> {
  const scale = input.scale === 4 ? 4 : 2;
  const url = await runPrediction(env, UPSCALE_MODEL, {
    image: input.image,
    scale,
  });
  const out = await fetchAsBase64(url);
  return { ...out, scale };
}

// Fetch the provider-hosted result and return its bytes inline so the
// client never has to hit a third-party CDN. Done server-side to keep
// the CSP and the codebase's "no vendor in client" posture intact.
async function fetchAsBase64(url: string): Promise<ImageOutput> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const contentType = res.headers.get('Content-Type') || 'image/png';
  const buf = new Uint8Array(await res.arrayBuffer());
  return { contentType, base64: bytesToBase64(buf) };
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid RangeError on large outputs (~6 MB upscale results).
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(s);
}

// ─── Provider-specific transport (rip and replace on swap) ──────────────

async function runPrediction(
  env: Env,
  modelRef: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (!env.IMAGE_MODEL_TOKEN) {
    throw new Error('IMAGE_MODEL_TOKEN not configured');
  }

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${modelRef}/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.IMAGE_MODEL_TOKEN}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input }),
    },
  );

  if (!createRes.ok) {
    throw new Error(`Image-model create failed: ${createRes.status}`);
  }

  let prediction = (await createRes.json()) as {
    id: string;
    status: string;
    output?: unknown;
    error?: string;
    urls?: { get: string };
  };

  const deadline = Date.now() + 60_000;
  while (
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    Date.now() < deadline
  ) {
    if (!prediction.urls?.get) break;
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${env.IMAGE_MODEL_TOKEN}` },
    });
    if (!poll.ok) throw new Error(`Image-model poll failed: ${poll.status}`);
    prediction = (await poll.json()) as typeof prediction;
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Image-model prediction ${prediction.status}: ${prediction.error ?? 'unknown'}`);
  }

  const output = prediction.output;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  throw new Error('Image-model prediction returned no usable output URL');
}
