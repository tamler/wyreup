import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface TextTranslateParams {
  /** Source language (ISO 639-1 or M2M100 language code, e.g. 'en', 'fr', 'ja', 'zh'). */
  sourceLang: string;
  /** Target language (ISO 639-1 or M2M100 language code). */
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

const TextTranslateComponentStub = (): unknown => null;

export const textTranslate: ToolModule<TextTranslateParams> = {
  id: 'text-translate',
  slug: 'text-translate',
  name: 'Translate Text',
  description: 'Translate between 100+ languages locally using M2M100 — runs on your device.',
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
  installSize: 400_000_000, // ~400 MB M2M100 418M
  installGroup: 'nlp-translate',
  requires: { webgpu: 'preferred' },

  defaults: defaultTextTranslateParams,
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

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading translation model (~400 MB on first use)' });

    const pipe = await getPipeline(ctx, 'translation', MODEL_ID, {
      src_lang: sourceLang,
      tgt_lang: targetLang,
    }) as (
      input: string,
      options?: Record<string, unknown>,
    ) => Promise<Array<{ translation_text: string }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await input.text();
    if (!text.trim()) {
      throw new Error('Input text is empty.');
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: `Translating ${sourceLang} → ${targetLang}` });

    const result = await pipe(text, { src_lang: sourceLang, tgt_lang: targetLang });
    const translated = Array.isArray(result)
      ? result[0]?.translation_text ?? ''
      : String(result);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([translated], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
