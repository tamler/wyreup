import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PasswordGeneratorParams } from './types.js';

export type { PasswordGeneratorParams } from './types.js';
export { defaultPasswordGeneratorParams } from './types.js';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

const AMBIGUOUS = new Set(['0', 'O', 'l', '1', 'I']);

const PasswordGeneratorComponentStub = (): unknown => null;

function buildCharset(params: PasswordGeneratorParams): { charset: string; required: string[] } {
  const excludeAmbiguous = params.excludeAmbiguous ?? false;

  function filter(str: string): string {
    if (!excludeAmbiguous) return str;
    return str.split('').filter((c) => !AMBIGUOUS.has(c)).join('');
  }

  const parts: Array<{ chars: string; enabled: boolean }> = [
    { chars: filter(UPPER), enabled: params.uppercase ?? true },
    { chars: filter(LOWER), enabled: params.lowercase ?? true },
    { chars: filter(DIGITS), enabled: params.digits ?? true },
    { chars: filter(SYMBOLS), enabled: params.symbols ?? true },
  ];

  const enabledParts = parts.filter((p) => p.enabled && p.chars.length > 0);
  if (enabledParts.length === 0) {
    throw new Error('At least one character category must be enabled');
  }

  const charset = enabledParts.map((p) => p.chars).join('');
  const required = enabledParts.map((p) => {
    const idx = crypto.getRandomValues(new Uint32Array(1))[0]! % p.chars.length;
    return p.chars[idx]!;
  });

  return { charset, required };
}

function generatePassword(params: PasswordGeneratorParams): string {
  const length = params.length ?? 16;
  const { charset, required } = buildCharset(params);

  if (length < required.length) {
    throw new Error(`Password length ${length} is too short to satisfy all enabled character categories`);
  }

  const remaining = length - required.length;
  const randIndices = crypto.getRandomValues(new Uint32Array(remaining));
  const extra = Array.from(randIndices, (n) => charset[n % charset.length]!);

  const all = [...required, ...extra];

  // Fisher-Yates shuffle using crypto
  const shuffleRand = crypto.getRandomValues(new Uint32Array(all.length));
  for (let i = all.length - 1; i > 0; i--) {
    const j = shuffleRand[i]! % (i + 1);
    const tmp = all[i]!;
    all[i] = all[j]!;
    all[j] = tmp;
  }

  return all.join('');
}

export const passwordGenerator: ToolModule<PasswordGeneratorParams> = {
  id: 'password-generator',
  slug: 'password-generator',
  name: 'Password Generator',
  description: 'Generate cryptographically random passwords with configurable character sets.',
  category: 'create',
  presence: 'both',
  keywords: ['password', 'generate', 'random', 'secure', 'credentials'],

  input: {
    accept: [],
    min: 0,
    max: 0,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    length: 16,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
    count: 1,
  },

  paramSchema: {
    length: {
      type: 'range',
      label: 'Length',
      min: 4,
      max: 128,
      step: 1,
      unit: 'chars',
    },
    uppercase: { type: 'boolean', label: 'Uppercase A–Z' },
    lowercase: { type: 'boolean', label: 'Lowercase a–z' },
    digits: { type: 'boolean', label: 'Digits 0–9' },
    symbols: { type: 'boolean', label: 'Symbols !@#$…' },
    excludeAmbiguous: {
      type: 'boolean',
      label: 'Exclude ambiguous',
      help: 'Skip 0/O/l/1/I to avoid confusion in copy-paste.',
    },
    count: {
      type: 'number',
      label: 'How many to generate',
      min: 1,
      max: 100,
      step: 1,
    },
  },

  Component: PasswordGeneratorComponentStub,

  // Tool contract requires Promise return; no internal await needed.
   
  async run(
    _inputs: File[],
    params: PasswordGeneratorParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Generating password' });

    const count = params.count ?? 1;
    if (count < 1) throw new Error('count must be >= 1');
    if (count > 1000) throw new Error('count must be <= 1000');
    const passwords: string[] = [];

    for (let i = 0; i < count; i++) {
      passwords.push(generatePassword(params));
    }

    const output = passwords.join('\n');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
