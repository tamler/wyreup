// Audio-model provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signature (`transcribe`) is what the rest of the code imports, so
// swaps don't ripple beyond this module.
//
// Current backend: Cloudflare Workers AI (Whisper-large-v3-turbo). The
// env.AI binding ships with Pages Functions — no token needed. Groq's
// Whisper-large-v3 turbo is ~5× cheaper per audio-minute; switch by
// replacing this body and adding AUDIO_MODEL_TOKEN to env.ts.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export interface TranscribeArgs {
  /** Raw audio bytes — Workers AI accepts most common containers. */
  bytes: Uint8Array;
  /** Optional ISO 639-1 language hint; faster + more accurate than auto-detect. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  /** WebVTT-formatted captions if the model returned them. */
  vtt?: string | null;
}

export async function transcribe(
  env: Env,
  args: TranscribeArgs,
): Promise<TranscribeResult> {
  // Workers AI expects audio as an integer array of byte values.
  const audioArr = Array.from(args.bytes);

  const res = (await withTimeout(
    env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: audioArr,
      language: args.language,
    }),
    INFERENCE_TIMEOUTS.audio,
    'whisper',
  )) as { text?: string; vtt?: string };

  if (!res || typeof res.text !== 'string') {
    throw new Error('Audio model returned no text');
  }
  return { text: res.text, vtt: res.vtt ?? null };
}
