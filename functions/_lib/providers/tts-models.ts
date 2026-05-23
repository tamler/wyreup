// TTS provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signature (`synthesize`) is what the rest of the code imports, so swaps
// don't ripple beyond this module.
//
// Current backend: Cloudflare Workers AI (melotts). The env.AI binding
// ships with Pages Functions — no token needed. Premium voice (Deepgram
// aura-2) lands here too when Wave 2 ships.

import type { Env } from '../env';

const TTS_MODEL = '@cf/myshell-ai/melotts';

// Melotts language codes. The model accepts a free-form `language` param
// and emits MP3 bytes; we keep the surface narrow on purpose — only the
// languages we've validated round-trip.
export type TtsLang = 'EN' | 'ES' | 'FR' | 'ZH' | 'JP' | 'KR';

export interface SynthesizeArgs {
  text: string;
  language?: TtsLang;
}

export interface SynthesizeResult {
  contentType: 'audio/mpeg';
  /** Base64-encoded MP3 bytes. */
  base64: string;
}

// Cap text length so worst-case run still clears the 50% margin floor.
// At melotts' $0.0002/audio-minute and ~150 wpm, 8k chars ≈ 8 minutes
// ≈ $0.0016 — still >90% margin on a 2-credit ($0.050 net) run.
export const TTS_MAX_CHARS = 8_000;

export async function synthesize(env: Env, args: SynthesizeArgs): Promise<SynthesizeResult> {
  if (args.text.length > TTS_MAX_CHARS) {
    throw new Error(`text exceeds ${TTS_MAX_CHARS} characters`);
  }
  const res = (await env.AI.run(TTS_MODEL, {
    prompt: args.text,
    lang: args.language ?? 'EN',
  })) as { audio?: string };
  if (!res || typeof res.audio !== 'string') {
    throw new Error('TTS model returned no audio');
  }
  // Workers AI returns base64-encoded MP3 already.
  return { contentType: 'audio/mpeg', base64: res.audio };
}
