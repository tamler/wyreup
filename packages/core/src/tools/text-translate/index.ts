import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface TextTranslateParams {
  /** Source language (ISO 639-1 code, e.g. 'en', 'fr', 'ja'). */
  sourceLang: string;
  /** Target language (ISO 639-1 code). */
  targetLang: string;
}

export const defaultTextTranslateParams: TextTranslateParams = {
  sourceLang: 'en',
  targetLang: 'fr',
};

// M2M100 418M — MIT licensed, ~400 MB
// https://huggingface.co/Xenova/m2m100_418M
// Direct many-to-many translation for 100+ language pairs.
// NLLB-200 is non-commercial (CC-BY-NC 4.0) — rejected.
const MODEL_ID = 'Xenova/m2m100_418M';

// Top languages by usage for the UI dropdown (ISO 639-1 codes)
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (Simplified)' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'th', label: 'Thai' },
  { value: 'id', label: 'Indonesian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'cs', label: 'Czech' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ms', label: 'Malay' },
];

const TextTranslateComponentStub = (): unknown => null;

/**
 * Try the browser's built-in on-device Translator API. Returns translated
 * text on success, null if unavailable or unsupported pair.
 *
 * Two API generations are checked, modern first:
 *   1. Chrome 138+ stable: global `Translator.create({...})` /
 *      `Translator.availability({...})`
 *   2. Chrome 131-137 origin-trial: `window.translation.createTranslator`
 *
 * Both are on-device (no network), so they preserve the privacy story.
 */
async function tryBrowserTranslator(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string | null> {
  if (typeof window === 'undefined' && typeof self === 'undefined') return null;

  // Path 1: modern global `Translator` API (Chrome 138+ stable).
  // Translator is a class — `typeof class === 'function'`. The previous
  // `typeof === 'object'` check wrongly filtered it out, so this branch
  // never executed and users fell through to the 400 MB M2M100 path.
  const globalScope =
    (typeof self !== 'undefined' ? self : (window as unknown)) as Record<string, unknown>;
  const TranslatorApi = globalScope['Translator'];
  if (TranslatorApi) {
    const T = TranslatorApi as Record<string, unknown>;
    if (typeof T['availability'] === 'function' && typeof T['create'] === 'function') {
      try {
        const availability = await (T['availability'] as (opts: unknown) => Promise<string>)({
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
        });
        // 'available' = ready now; 'downloadable' = browser will fetch
        // the language pack on Translator.create. 'downloading' = fetch
        // already in progress. Anything else (incl. 'unavailable') bails.
        if (
          availability === 'available' ||
          availability === 'downloadable' ||
          availability === 'downloading'
        ) {
          const translator = await (T['create'] as (opts: unknown) => Promise<unknown>)({
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
          });
          if (translator && typeof translator === 'object') {
            const t = translator as Record<string, unknown>;
            if (typeof t['translate'] === 'function') {
              const result = await (t['translate'] as (text: string) => Promise<string>)(text);
              if (typeof result === 'string') return result;
            }
          }
        }
      } catch {
        // Fall through to legacy API.
      }
    }
  }

  // Path 2: legacy `window.translation` API (Chrome 131-137 origin trial).
  if (typeof window === 'undefined') return null;
  const translationApi = (window as unknown as Record<string, unknown>)['translation'];
  if (!translationApi || typeof translationApi !== 'object') return null;
  const api = translationApi as Record<string, unknown>;
  if (typeof api['canTranslate'] !== 'function') return null;

  try {
    const canTranslate = await (api['canTranslate'] as (opts: unknown) => Promise<string>)({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
    });
    if (canTranslate !== 'readily' && canTranslate !== 'after-download') return null;

    const createTranslator = api['createTranslator'] as (opts: unknown) => Promise<unknown>;
    const translator = await createTranslator({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
    });

    if (!translator || typeof translator !== 'object') return null;
    const t = translator as Record<string, unknown>;
    if (typeof t['translate'] !== 'function') return null;

    const result = await (t['translate'] as (text: string) => Promise<string>)(text);
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
}

export const textTranslate: ToolModule<TextTranslateParams> = {
  id: 'text-translate',
  slug: 'text-translate',
  name: 'Translate Text',
  description: 'Translate between 100+ languages. Uses your browser\'s built-in translator when available (Chrome 131+), falling back to the M2M100 model.',
  category: 'text',
  presence: 'both',
  keywords: ['translate', 'translation', 'language', 'multilingual', 'm2m', 'localize'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024, // 500 KB — M2M100 has a token limit; keep input reasonable
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 400_000_000, // ~400 MB M2M100 418M (fallback only)
  installGroup: 'nlp-translate',
  requires: { webgpu: 'preferred' },

  defaults: defaultTextTranslateParams,

  paramSchema: {
    sourceLang: {
      type: 'enum',
      label: 'source language',
      options: LANGUAGE_OPTIONS,
    },
    targetLang: {
      type: 'enum',
      label: 'target language',
      options: LANGUAGE_OPTIONS,
    },
  },

  Component: TextTranslateComponentStub,

  async run(inputs: File[], params: TextTranslateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-translate accepts exactly one text file.');
    }
    const input = inputs[0]!;

    const { sourceLang, targetLang } = params;
    if (!sourceLang || !targetLang) {
      throw new Error('sourceLang and targetLang are required.');
    }
    if (sourceLang === targetLang) {
      throw new Error('sourceLang and targetLang must be different.');
    }

    const text = await input.text();
    if (!text.trim()) {
      throw new Error('Input text is empty.');
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    // Path 1: Browser-native Translator API (Chrome 138+ stable, also
    // legacy Chrome 131-137). Tried FIRST so users on supported
    // browsers don't download the 400 MB fallback model — Chrome
    // ships its own translation language packs on demand.
    ctx.onProgress({
      stage: 'loading-deps',
      percent: 20,
      message: 'Trying browser-native translator…',
    });
    const browserResult = await tryBrowserTranslator(text, sourceLang, targetLang);

    if (browserResult !== null) {
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done (translated by your browser, no download)' });
      return [new Blob([browserResult], { type: 'text/plain' })];
    }

    // Path 2: M2M100 via Transformers.js (fallback for browsers without
    // the Translator API — Firefox, Safari, older Chrome).
    ctx.onProgress({
      stage: 'loading-deps',
      percent: 0,
      message: 'Browser translator unavailable — loading M2M100 (~400 MB on first use)',
    });

    const pipe = await getPipeline(ctx, 'translation', MODEL_ID, {
      src_lang: sourceLang,
      tgt_lang: targetLang,
    }) as (
      input: string,
      options?: Record<string, unknown>,
    ) => Promise<Array<{ translation_text: string }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: `Translating ${sourceLang} -> ${targetLang}` });

    const result = await pipe(text, { src_lang: sourceLang, tgt_lang: targetLang });
    const translated = Array.isArray(result)
      ? result[0]?.translation_text ?? ''
      : String(result);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done (M2M100)' });
    return [new Blob([translated], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
