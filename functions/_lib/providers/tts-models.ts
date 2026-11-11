// TTS provider wrapper.
//
// One file, one vendor. Replace the body when switching backends. Public
// signature (`synthesize`) is what the rest of the code imports, so swaps
// don't ripple beyond this module.
//
// Current backend: Cloudflare Workers AI, Deepgram Aura. English runs on
// @cf/deepgram/aura-1, Spanish on @cf/deepgram/aura-2-es (Aura 1 is
// English only). MeloTTS is retired by Cloudflare on 2026-11-20, which is
// why French, Chinese, Japanese and Korean are no longer offered.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export type TtsLang = 'EN' | 'ES';

export const TTS_LANGS: readonly TtsLang[] = ['EN', 'ES'];

export const TTS_MODELS: Readonly<Record<TtsLang, string>> = {
  EN: '@cf/deepgram/aura-1',
  ES: '@cf/deepgram/aura-2-es',
};

// Speaker enums from each model's schema-input.json on
// developers.cloudflare.com/workers-ai/models/<model>/.
export const TTS_VOICES: Readonly<Record<TtsLang, readonly string[]>> = {
  EN: [
    'asteria',
    'luna',
    'stella',
    'athena',
    'hera',
    'orion',
    'arcas',
    'perseus',
    'angus',
    'orpheus',
    'helios',
    'zeus',
  ],
  ES: [
    'aquila',
    'celeste',
    'carina',
    'diana',
    'estrella',
    'selena',
    'alvaro',
    'javier',
    'nestor',
    'sirio',
  ],
};

export const TTS_DEFAULT_VOICE: Readonly<Record<TtsLang, string>> = {
  EN: 'asteria',
  ES: 'aquila',
};

// Cloudflare list price, USD per 1,000 input characters.
export const TTS_USD_PER_1K_CHARS: Readonly<Record<TtsLang, number>> = {
  EN: 0.015,
  ES: 0.03,
};

// Per-language character caps, sized so the worst-case run stays under the
// 50% cost floor on a 2-credit run (asserted in cost-model.test.ts):
// EN 1,000 x $0.015/1k = $0.015, ES 500 x $0.030/1k = $0.015.
// `text.length` counts UTF-16 code units, never fewer than the characters
// Deepgram bills, so the check is conservative.
export const TTS_MAX_CHARS: Readonly<Record<TtsLang, number>> = {
  EN: 1_000,
  ES: 500,
};

// A minute of speech is roughly 900 characters and well under 2 MB of MP3.
// Anything far beyond that is a provider fault, not a real clip.
const TTS_MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface SynthesizeArgs {
  text: string;
  language?: TtsLang;
  voice?: string;
}

export interface SynthesizeResult {
  contentType: 'audio/mpeg';
  /** Base64-encoded MP3 bytes. */
  base64: string;
}

/** Validates language, character cap and voice. Throws before any provider work. */
export function checkTtsInput(args: SynthesizeArgs): { language: TtsLang; voice: string } {
  const language = args.language ?? 'EN';
  if (!TTS_LANGS.includes(language)) throw new Error('Unsupported TTS language');
  const max = TTS_MAX_CHARS[language];
  if (args.text.length > max) {
    throw new Error(`text exceeds ${max} characters`);
  }
  const voice = args.voice ?? TTS_DEFAULT_VOICE[language];
  if (!TTS_VOICES[language].includes(voice)) throw new Error('Unsupported TTS voice');
  return { language, voice };
}

export async function synthesize(env: Env, args: SynthesizeArgs): Promise<SynthesizeResult> {
  const { language, voice } = checkTtsInput(args);
  const model = TTS_MODELS[language];
  // One deadline covers the inference call and reading the whole audio
  // stream: Aura resolves with a ReadableStream before the body arrives, so
  // a stalled stream must also time out (and be cancelled) for the run to
  // fail fast and refund.
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const work = (async () => {
    const res: unknown = await env.AI.run(model, {
      text: args.text,
      speaker: voice,
      encoding: 'mp3',
    });
    return audioBytes(res, (r) => {
      reader = r;
    });
  })();
  let bytes: Uint8Array;
  try {
    bytes = await withTimeout(work, INFERENCE_TIMEOUTS.tts, `tts (${model})`);
  } catch (error) {
    if (reader) await reader.cancel(error).catch(() => {});
    // Keep a late rejection from the abandoned work from going unhandled.
    work.catch(() => {});
    throw error;
  }
  if (bytes.length === 0) throw new Error('TTS model returned no audio');
  return { contentType: 'audio/mpeg', base64: bytesToBase64(bytes) };
}

// The binding returns a ReadableStream of MP3 bytes for Aura. Other binary
// shapes are accepted too, so a binding change degrades to a clear error
// instead of corrupt output.
async function audioBytes(
  res: unknown,
  onReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
): Promise<Uint8Array> {
  if (res instanceof Uint8Array) return res;
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  if (res instanceof Response) return readStream(res.body, onReader);
  if (res instanceof ReadableStream) {
    return readStream(res as ReadableStream<Uint8Array>, onReader);
  }
  throw new Error('TTS model returned no audio');
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
  onReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  onReader(reader);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > TTS_MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error('TTS audio exceeds size cap');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
