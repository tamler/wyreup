import type { ToolModule, ToolRunContext } from '../../types.js';

export type UnicodeNormalForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD';

export interface UnicodeNormalizeParams {
  /** Unicode normalization form. Default NFC (precomposed, most common). */
  form?: UnicodeNormalForm;
}

export const defaultUnicodeNormalizeParams: UnicodeNormalizeParams = {
  form: 'NFC',
};

const UnicodeNormalizeComponentStub = (): unknown => null;

/**
 * Normalize a string to the given Unicode normalization form.
 * Uses the built-in String.prototype.normalize — no library needed.
 */
export function normalizeUnicode(text: string, form: UnicodeNormalForm): string {
  return text.normalize(form);
}

export const unicodeNormalize: ToolModule<UnicodeNormalizeParams> = {
  id: 'unicode-normalize',
  slug: 'unicode-normalize',
  name: 'Unicode Normalize',
  description: 'Normalize Unicode text to NFC, NFD, NFKC, or NFKD — removes invisible differences between identical-looking strings.',
  category: 'text',
  presence: 'both',
  keywords: ['unicode', 'normalize', 'nfc', 'nfd', 'nfkc', 'nfkd', 'encoding', 'text'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultUnicodeNormalizeParams,

  paramSchema: {
    form: {
      type: 'enum',
      label: 'form',
      help: 'NFC is the most common. Use NFKC/NFKD to also apply compatibility decomposition.',
      options: [
        { value: 'NFC', label: 'NFC — precomposed (most common)' },
        { value: 'NFD', label: 'NFD — decomposed' },
        { value: 'NFKC', label: 'NFKC — compatibility precomposed' },
        { value: 'NFKD', label: 'NFKD — compatibility decomposed' },
      ],
    },
  },

  Component: UnicodeNormalizeComponentStub,

  async run(inputs: File[], params: UnicodeNormalizeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('unicode-normalize accepts exactly one text file.');
    }
    const input = inputs[0]!;

    const form = params.form ?? 'NFC';
    const validForms: UnicodeNormalForm[] = ['NFC', 'NFD', 'NFKC', 'NFKD'];
    if (!validForms.includes(form)) {
      throw new Error(`Invalid normalization form: ${form}. Valid forms: ${validForms.join(', ')}`);
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading text' });

    const text = await input.text();

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: `Normalizing to ${form}` });

    const normalized = normalizeUnicode(text, form);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([normalized], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
