import type { Env } from '../env';
import { INFERENCE_TIMEOUTS, withTimeout } from '../timeout';
import { boundedText, TTS_MAX_BYTES, ttsLanguage } from '../../../packages/core/src/lib/pro-migration-limits';

export type TtsLang = 'EN' | 'ES';
export const TTS_MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export function validateTts(text: string, language: string): asserts language is TtsLang {
  ttsLanguage(language);
  boundedText(text, TTS_MAX_BYTES, 'Text to Speech input');
}

export async function synthesize(env: Env, args: { text: string; language?: TtsLang }): Promise<{ contentType: 'audio/mpeg'; base64: string }> {
  const language = args.language ?? 'EN';
  validateTts(args.text, language);
  const model = language === 'EN' ? '@cf/deepgram/aura-2-en' : '@cf/deepgram/aura-2-es';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let expired = false;
  const work = (async () => {
    const res = await env.AI.run(model, { text: args.text, speaker: language === 'EN' ? 'luna' : 'aquila', encoding: 'mp3' });
    if (!(res instanceof ReadableStream)) throw new Error('TTS model returned invalid audio');
    if (expired) { void res.cancel().catch(() => {}); throw new Error('TTS timed out'); }
    reader = (res as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('TTS model returned invalid audio');
        total += value.byteLength;
        if (total > TTS_MAX_AUDIO_BYTES) throw new Error('TTS audio exceeds size limit');
        chunks.push(value);
      }
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      throw error;
    }
    if (!total) throw new Error('TTS model returned no audio');
    let binary = '';
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i += 0x8000) binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  })();
  try {
    const base64 = await withTimeout(work, INFERENCE_TIMEOUTS.tts, 'tts');
    return { contentType: 'audio/mpeg', base64 };
  } catch (error) {
    expired = true;
    if (reader) void reader.cancel(error).catch(() => {});
    throw error;
  }
}
