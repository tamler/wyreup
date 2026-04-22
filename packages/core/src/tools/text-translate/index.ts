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
 * Try the Chrome 131+ built-in Translator API (window.translation).
 * Returns translated text on success, null if unavailable or unsupported pair.
 */
async function tryBrowserTranslator(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const win = window as unknown as Record<string, unknown>;
  const translationApi = win['translation'];
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
    return result ?? null;
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

    // Path 1: Browser-native Translator API (Chrome 131+)
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Checking for browser translator...' });
    const browserResult = await tryBrowserTranslator(text, sourceLang, targetLang);

    if (browserResult !== null) {
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done (browser-native)' });
      return [new Blob([browserResult], { type: 'text/plain' })];
    }

    // Path 2: M2M100 via Transformers.js (fallback)
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading translation model (~400 MB on first use)' });

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
