import type { ToolModule, ToolRunContext } from '../../types.js';

export type StrengthTier = 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong';

export interface PasswordStrengthParams {
  /** Password to evaluate. Required. Never leaves the device. */
  password?: string;
}

export const defaultPasswordStrengthParams: PasswordStrengthParams = {
  password: '',
};

export interface PasswordStrengthResult {
  length: number;
  /** Bits of entropy estimated from the inferred keyspace. */
  entropyBits: number;
  /** Keyspace size used in the entropy calculation. */
  keyspace: number;
  classes: {
    lowercase: boolean;
    uppercase: boolean;
    digit: boolean;
    symbol: boolean;
    space: boolean;
    /** Anything outside the standard ASCII printable range. */
    extended: boolean;
  };
  uniqueChars: number;
  isCommon: boolean;
  /** Tier maps entropy to a human label. See thresholds in source. */
  tier: StrengthTier;
  /** Actionable suggestions ranked by impact. */
  suggestions: string[];
}

const PasswordStrengthComponentStub = (): unknown => null;

// Short, intentional list of "obviously broken" passwords. Not meant to
// be a 10k common-password dictionary (that's zxcvbn territory and
// belongs behind a lib). The point here is to catch the obvious cases
// so the tier doesn't lie when the entropy math says "fair".
const COMMON_PASSWORDS = new Set<string>([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'admin',
  'root',
  'iloveyou',
  'monkey',
  'dragon',
  'baseball',
  'football',
  'master',
  'welcome',
  'login',
  '000000',
  '111111',
  'changeme',
  'sunshine',
  'princess',
]);

export function evaluatePassword(password: string): PasswordStrengthResult {
  const length = password.length;
  const classes = {
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[!-/:-@[-`{-~]/.test(password),
    space: /\s/.test(password),
    extended: /[^\x20-\x7e]/.test(password),
  };
  // Keyspace per WCAG/NIST-style estimates. Conservative — assumes the
  // attacker knows which classes are in use.
  let keyspace = 0;
  if (classes.lowercase) keyspace += 26;
  if (classes.uppercase) keyspace += 26;
  if (classes.digit) keyspace += 10;
  if (classes.symbol) keyspace += 32;
  if (classes.space) keyspace += 1;
  if (classes.extended) keyspace += 128;

  const entropyBits = keyspace > 0 && length > 0 ? length * Math.log2(keyspace) : 0;
  const rounded = Math.round(entropyBits * 100) / 100;

  const uniqueChars = new Set(password).size;
  const isCommon = COMMON_PASSWORDS.has(password.toLowerCase());

  let tier: StrengthTier;
  if (isCommon || entropyBits < 28) tier = 'very-weak';
  else if (entropyBits < 36) tier = 'weak';
  else if (entropyBits < 60) tier = 'fair';
  else if (entropyBits < 80) tier = 'strong';
  else tier = 'very-strong';

  const suggestions: string[] = [];
  if (isCommon) suggestions.push('This password is on a public common-passwords list. Pick something else.');
  if (length < 12) suggestions.push('Aim for at least 12 characters. 16+ is much better.');
  if (!classes.uppercase && !classes.symbol && !classes.extended) {
    suggestions.push('Mix character classes (uppercase, symbols, or non-ASCII characters).');
  }
  if (uniqueChars < Math.min(length, 8)) {
    suggestions.push('Use a wider set of distinct characters — long passwords made of repeats are not strong.');
  }
  if (suggestions.length === 0 && tier !== 'very-strong') {
    suggestions.push('Add length. Each extra character doubles the search space when classes are fixed.');
  }

  return {
    length,
    entropyBits: rounded,
    keyspace,
    classes,
    uniqueChars,
    isCommon,
    tier,
    suggestions,
  };
}

export const passwordStrength: ToolModule<PasswordStrengthParams> = {
  id: 'password-strength',
  slug: 'password-strength',
  name: 'Password Strength',
  description:
    'Estimate password entropy in bits, classify character mix, and flag passwords from a small common-passwords list. Nothing leaves your device.',
  category: 'inspect',
  presence: 'both',
  keywords: ['password', 'strength', 'entropy', 'security', 'check', 'weak', 'strong', 'audit'],

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

  defaults: defaultPasswordStrengthParams,

  paramSchema: {
    password: {
      type: 'string',
      label: 'password',
      help: 'Typed locally, never uploaded. The form should mask it.',
      placeholder: 'enter a password to check',
    },
  },

  Component: PasswordStrengthComponentStub,

  async run(_inputs: File[], params: PasswordStrengthParams, ctx: ToolRunContext): Promise<Blob[]> {
    const password = params.password ?? '';
    if (!password) throw new Error('password-strength requires a password to evaluate.');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Estimating entropy' });
    const result = evaluatePassword(password);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
