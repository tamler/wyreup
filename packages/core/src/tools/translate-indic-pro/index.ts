import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface TranslateIndicProParams {
  target?:
    | 'hin_Deva'
    | 'ben_Beng'
    | 'tam_Taml'
    | 'tel_Telu'
    | 'mar_Deva'
    | 'guj_Gujr'
    | 'pan_Guru'
    | 'mal_Mlym'
    | 'kan_Knda'
    | 'urd_Arab'
    | 'asm_Beng';
}

export const defaultTranslateIndicProParams: TranslateIndicProParams = { target: 'hin_Deva' };

export const translateIndicPro: ToolModule<TranslateIndicProParams> = {
  id: 'translate-indic-pro',
  slug: 'translate-indic-pro',
  name: 'Translate to Indic Languages',
  description:
    'Hosted IndicTrans2 — purpose-built English-to-Indic translation across Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Punjabi, Malayalam, Kannada, Urdu, and Assamese. Higher fidelity for these languages than a general LLM. Uses 1 credit per run.',
  category: 'text',
  keywords: ['translate', 'indic', 'hindi', 'tamil', 'bengali', 'india', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 128 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-to-speech-pro'],

  defaults: defaultTranslateIndicProParams,
  paramSchema: {
    target: {
      type: 'enum',
      label: 'target language',
      options: [
        { value: 'hin_Deva', label: 'Hindi' },
        { value: 'ben_Beng', label: 'Bengali' },
        { value: 'tam_Taml', label: 'Tamil' },
        { value: 'tel_Telu', label: 'Telugu' },
        { value: 'mar_Deva', label: 'Marathi' },
        { value: 'guj_Gujr', label: 'Gujarati' },
        { value: 'pan_Guru', label: 'Punjabi' },
        { value: 'mal_Mlym', label: 'Malayalam' },
        { value: 'kan_Knda', label: 'Kannada' },
        { value: 'urd_Arab', label: 'Urdu' },
        { value: 'asm_Beng', label: 'Assamese' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: TranslateIndicProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('translate-indic-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    const target = params.target ?? 'hin_Deva';

    const result = await runPro<{ translation: string }>(
      'translate-indic-pro',
      { text, target, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.translation], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
