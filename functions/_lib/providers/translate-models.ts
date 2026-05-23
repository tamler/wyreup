// Specialty translation provider wrapper.
//
// Distinct from text-models.ts on purpose — these are dedicated seq2seq
// translators (m2m100, indictrans2) with a different API shape than
// chat-style LLMs. Calling them is cheaper and more accurate for direct
// language-pair translation than prompting a general LLM.
//
// Current backend: Cloudflare Workers AI. Swap to a self-hosted NMT
// stack by replacing the bodies and exporting the same signatures.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

const M2M100_MODEL = '@cf/meta/m2m100-1.2b';
const INDICTRANS2_MODEL = '@cf/ai4bharat/indictrans2-en-indic-1B';

export interface TranslateArgs {
  text: string;
  /** ISO language code or plain name ('en', 'fr', 'es', 'zh', etc). */
  source?: string;
  /** ISO language code or plain name. */
  target: string;
}

export interface TranslateResult {
  translation: string;
}

export async function translateMany(env: Env, args: TranslateArgs): Promise<TranslateResult> {
  const res = (await withTimeout(
    env.AI.run(M2M100_MODEL, {
      text: args.text,
      source_lang: args.source ?? 'en',
      target_lang: args.target,
    }),
    INFERENCE_TIMEOUTS.translate,
    'translate-m2m100',
  )) as { translated_text?: string };
  if (!res || typeof res.translated_text !== 'string') {
    throw new Error('Translation model returned no text');
  }
  return { translation: res.translated_text.trim() };
}

// 11 Indic target languages. We list explicitly so the UI dropdown only
// shows what the model handles.
export type IndicLang =
  | 'hin_Deva' // Hindi
  | 'ben_Beng' // Bengali
  | 'tam_Taml' // Tamil
  | 'tel_Telu' // Telugu
  | 'mar_Deva' // Marathi
  | 'guj_Gujr' // Gujarati
  | 'pan_Guru' // Punjabi
  | 'mal_Mlym' // Malayalam
  | 'kan_Knda' // Kannada
  | 'urd_Arab' // Urdu
  | 'asm_Beng'; // Assamese

export interface IndicTranslateArgs {
  text: string;
  target: IndicLang;
}

export async function translateIndic(
  env: Env,
  args: IndicTranslateArgs,
): Promise<TranslateResult> {
  const res = (await withTimeout(
    env.AI.run(INDICTRANS2_MODEL, {
      source_language: 'eng_Latn',
      target_language: args.target,
      contents: [args.text],
    }),
    INFERENCE_TIMEOUTS.translate,
    'translate-indictrans2',
  )) as { translations?: string[]; translation?: string };
  // The model has historically returned both shapes — accept either.
  const out =
    (Array.isArray(res.translations) ? res.translations[0] : undefined) ?? res.translation;
  if (typeof out !== 'string') {
    throw new Error('Indic translation model returned no text');
  }
  return { translation: out.trim() };
}
