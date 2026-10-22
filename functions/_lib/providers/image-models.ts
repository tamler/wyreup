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
import { INFERENCE_TIMEOUTS, InferenceTimeoutError } from '../timeout';

export interface BgRemoveInput {
  /** Validated PNG/JPEG/WebP data URL from the preparation boundary. */
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
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;

export async function runBgRemove(input: BgRemoveInput, env: Env): Promise<ImageOutput> {
  return withImageDeadline(async (signal) => {
    const url = await runPrediction(env, BG_REMOVE_MODEL, { image: input.image }, signal);
    return fetchAsBase64(url, signal);
  });
}

export async function runUpscale(input: UpscaleInput, env: Env): Promise<ImageOutput> {
  const scale = input.scale === 4 ? 4 : 2;
  return withImageDeadline(async (signal) => {
    const url = await runPrediction(env, UPSCALE_MODEL, { image: input.image, scale }, signal);
    const out = await fetchAsBase64(url, signal);
    return { ...out, scale };
  });
}

/** One deadline covers creation, polling, metadata, and output streaming. */
async function withImageDeadline<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new InferenceTimeoutError('image-provider', INFERENCE_TIMEOUTS.image);
      controller.abort(error);
      reject(error);
    }, INFERENCE_TIMEOUTS.image);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function readBoundedBody(
  response: Response,
  limit: number,
  signal: AbortSignal,
  consume: (chunk: Uint8Array) => void,
): Promise<void> {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel();
    throw new Error('Image provider response exceeds size limit');
  }
  if (!response.body) throw new Error('Image provider returned no body');
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Image provider response exceeds size limit');
      consume(value);
    }
    if (total === 0) throw new Error('Image provider returned empty body');
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

// Fetch the provider-hosted result and return its bytes inline so the
// client never has to hit a third-party CDN. Done server-side to keep
// the CSP and the codebase's "no vendor in client" posture intact.
async function fetchAsBase64(url: string, signal: AbortSignal): Promise<ImageOutput> {
  const parsed = new URL(url);
  // Replicate documents this output-domain contract at
  // https://replicate.com/docs/topics/predictions/output-files/
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !(parsed.hostname === 'replicate.delivery' || parsed.hostname.endsWith('.replicate.delivery'))
  ) {
    throw new Error('Untrusted image output URL');
  }
  const res = await fetch(parsed.href, { redirect: 'error', signal });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const contentType = res.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
    await res.body?.cancel();
    throw new Error('Unsupported image provider content type');
  }
  // Encode incrementally, keeping at most two unencoded bytes across chunks.
  // Avoid retaining a full binary buffer alongside the base64/JSON response.
  const parts: string[] = [];
  let carry: Uint8Array = new Uint8Array();
  await readBoundedBody(res, MAX_OUTPUT_BYTES, signal, (chunk) => {
    const bytes = new Uint8Array(carry.length + chunk.length);
    bytes.set(carry);
    bytes.set(chunk, carry.length);
    const complete = bytes.length - (bytes.length % 3);
    if (complete) parts.push(bytesToBase64(bytes.subarray(0, complete)));
    carry = bytes.slice(complete);
  });
  if (carry.length) parts.push(bytesToBase64(carry));
  return { contentType, base64: parts.join('') };
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
  signal: AbortSignal,
): Promise<string> {
  if (!env.IMAGE_MODEL_TOKEN) {
    throw new Error('IMAGE_MODEL_TOKEN not configured');
  }

  const createRes = await fetch(`https://api.replicate.com/v1/models/${modelRef}/predictions`, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      Authorization: `Bearer ${env.IMAGE_MODEL_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
  });

  if (!createRes.ok) {
    throw new Error(`Image-model create failed: ${createRes.status}`);
  }

  let prediction = await readPrediction(createRes, signal);
  while (
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled'
  ) {
    if (typeof prediction.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(prediction.id)) {
      throw new Error('Invalid prediction id');
    }
    await pauseBeforePoll(signal);
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${env.IMAGE_MODEL_TOKEN}` },
    });
    if (!poll.ok) throw new Error(`Image-model poll failed: ${poll.status}`);
    prediction = await readPrediction(poll, signal);
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(
      `Image-model prediction ${prediction.status}: ${typeof prediction.error === 'string' ? prediction.error : 'unknown'}`,
    );
  }

  const output = prediction.output;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  throw new Error('Image-model prediction returned no usable output URL');
}

async function readPrediction(
  response: Response,
  signal: AbortSignal,
): Promise<{ id?: unknown; status: string; output?: unknown; error?: unknown }> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  await readBoundedBody(response, MAX_METADATA_BYTES, signal, (chunk) => {
    text += decoder.decode(chunk, { stream: true });
  });
  text += decoder.decode();
  const result: unknown = JSON.parse(text);
  if (
    !result ||
    typeof result !== 'object' ||
    !('status' in result) ||
    typeof result.status !== 'string'
  )
    throw new Error('Invalid image prediction response');
  return result as { id?: unknown; status: string; output?: unknown; error?: unknown };
}

function pauseBeforePoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1500);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('Image request aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
