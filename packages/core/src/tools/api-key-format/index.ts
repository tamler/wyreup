import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ApiKeyFormatParams {
  /** Prefix that brands the key (Stripe-style: sk_live_, pk_test_, ghp_, etc.). */
  prefix?: string;
  /** Number of random characters after the prefix. Each base32 char carries 5 bits. */
  randomLength?: number;
  /** Alphabet for the random body. */
  alphabet?: 'base32' | 'base32-lower' | 'alphanumeric' | 'hex';
  /** How many keys to generate at once. */
  count?: number;
}

export const defaultApiKeyFormatParams: ApiKeyFormatParams = {
  prefix: 'sk_live_',
  randomLength: 32,
  alphabet: 'base32-lower',
  count: 1,
};

export interface ApiKeyFormatResult {
  prefix: string;
  randomLength: number;
  alphabet: string;
  /** Bits of entropy in the random body — useful for guessing-attack math. */
  entropyBits: number;
  keys: string[];
}

const ALPHABETS = {
  base32: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  'base32-lower': 'abcdefghijklmnopqrstuvwxyz234567',
  alphanumeric: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz',
  hex: '0123456789abcdef',
} as const;

const ENTROPY_BITS: Record<keyof typeof ALPHABETS, number> = {
  base32: 5,
  'base32-lower': 5,
  alphanumeric: Math.log2(54),
  hex: 4,
};

function randomFromAlphabet(length: number, alphabet: string): string {
  const len = alphabet.length;
  const maxValid = 256 - (256 % len);
  let out = '';
  let pool = new Uint8Array(length * 2);
  crypto.getRandomValues(pool);
  let pi = 0;
  while (out.length < length) {
    if (pi >= pool.length) {
      pool = new Uint8Array(length * 2);
      crypto.getRandomValues(pool);
      pi = 0;
    }
    const b = pool[pi++]!;
    if (b < maxValid) out += alphabet[b % len];
  }
  return out;
}

export const apiKeyFormat: ToolModule<ApiKeyFormatParams> = {
  id: 'api-key-format',
  slug: 'api-key-format',
  name: 'API Key Format',
  description:
    'Generate API keys in the Stripe / GitHub / OpenAI shape: a stable prefix (sk_live_, ghp_, …) plus a cryptographically random body. Configurable alphabet and length. Pairs with backup-codes and password-generator for adjacent secret-generation needs.',
  category: 'create',
  keywords: ['api-key', 'token', 'secret', 'random', 'generate', 'stripe', 'github'],

  input: {
    accept: ['*/*'],
    min: 0,
    sizeLimit: 0,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultApiKeyFormatParams,

  paramSchema: {
    prefix: {
      type: 'string',
      label: 'prefix',
      help: 'Brand prefix (with separator). Stripe uses sk_live_ / sk_test_ / pk_live_, GitHub uses ghp_, OpenAI uses sk-.',
      placeholder: 'sk_live_',
    },
    randomLength: {
      type: 'number',
      label: 'random length',
      help: 'Characters after the prefix. 32 base32 chars = 160 bits (~SHA-1 equivalent).',
      min: 8,
      max: 128,
      step: 1,
    },
    alphabet: {
      type: 'enum',
      label: 'alphabet',
      options: [
        { value: 'base32-lower', label: 'base32 lowercase (Stripe-ish)' },
        { value: 'base32', label: 'base32 uppercase' },
        { value: 'alphanumeric', label: 'alphanumeric (no ambiguous chars)' },
        { value: 'hex', label: 'hex (16 chars)' },
      ],
    },
    count: {
      type: 'number',
      label: 'count',
      help: 'Generate this many keys in one batch.',
      min: 1,
      max: 100,
      step: 1,
    },
  },

  async run(_inputs: File[], params: ApiKeyFormatParams, ctx: ToolRunContext): Promise<Blob[]> {
    const prefix = params.prefix ?? '';
    const randomLength = Math.max(8, Math.min(128, params.randomLength ?? 32));
    const alphabetKey = params.alphabet ?? 'base32-lower';
    const alphabet = ALPHABETS[alphabetKey];
    const count = Math.max(1, Math.min(100, params.count ?? 1));

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Generating keys' });
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      keys.push(`${prefix}${randomFromAlphabet(randomLength, alphabet)}`);
    }

    const result: ApiKeyFormatResult = {
      prefix,
      randomLength,
      alphabet: alphabetKey,
      entropyBits: Math.round(randomLength * ENTROPY_BITS[alphabetKey] * 100) / 100,
      keys,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
