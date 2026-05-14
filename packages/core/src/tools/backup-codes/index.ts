import type { ToolModule, ToolRunContext } from '../../types.js';
import { encodeBase32 } from '../base32/index.js';

export interface BackupCodesParams {
  /** How many codes to generate. */
  count?: number;
  /** Total alphabet characters per code (excluding group separator). */
  codeLength?: number;
  /** Group size to insert separator after (0 = none). */
  groupSize?: number;
  separator?: '-' | ' ' | '·';
  /** Alphabet style. base32 is unambiguous; numeric matches Steam-style. */
  alphabet?: 'base32' | 'base32-lower' | 'numeric' | 'alphanumeric';
}

export const defaultBackupCodesParams: BackupCodesParams = {
  count: 10,
  codeLength: 10,
  groupSize: 5,
  separator: '-',
  alphabet: 'base32',
};

export interface BackupCodesResult {
  count: number;
  codeLength: number;
  alphabet: string;
  codes: string[];
}

const BackupCodesComponentStub = (): unknown => null;

const ALPHABETS = {
  base32: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  'base32-lower': 'abcdefghijklmnopqrstuvwxyz234567',
  numeric: '0123456789',
  alphanumeric: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // Crockford-ish: no 0/1/I/L/O
} as const;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function randomCode(length: number, alphabet: string): string {
  // Use rejection sampling so each character is uniform across the alphabet.
  // `Math.floor(rand * len)` is biased when 256 % len !== 0; reject anything
  // above the largest multiple of len.
  const alphabetLen = alphabet.length;
  const maxValid = 256 - (256 % alphabetLen);
  let out = '';
  let i = 0;
  // Over-allocate so we rarely need a second pass.
  let pool = randomBytes(length * 2);
  let pi = 0;
  while (i < length) {
    if (pi >= pool.length) {
      pool = randomBytes(length * 2);
      pi = 0;
    }
    const b = pool[pi++]!;
    if (b < maxValid) {
      out += alphabet[b % alphabetLen];
      i++;
    }
  }
  return out;
}

export function generateBackupCodes(params: BackupCodesParams): BackupCodesResult {
  const count = Math.max(1, Math.min(100, params.count ?? 10));
  const codeLength = Math.max(4, Math.min(64, params.codeLength ?? 10));
  const groupSize = Math.max(0, Math.min(codeLength, params.groupSize ?? 0));
  const separator = params.separator ?? '-';
  const alphabetKey = params.alphabet ?? 'base32';
  const alphabet = ALPHABETS[alphabetKey];

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomCode(codeLength, alphabet);
    if (groupSize > 0 && groupSize < codeLength) {
      const groups: string[] = [];
      for (let j = 0; j < raw.length; j += groupSize) {
        groups.push(raw.slice(j, j + groupSize));
      }
      codes.push(groups.join(separator));
    } else {
      codes.push(raw);
    }
  }

  return { count, codeLength, alphabet: alphabetKey, codes };
}

// encodeBase32 isn't strictly necessary here — we generate codes
// character-by-character against the base32 alphabet directly — but
// keeping the import documents the conceptual lineage (these are
// base32-alphabet codes, like the secrets that totp-code / hotp-code
// consume).
void encodeBase32;

export const backupCodes: ToolModule<BackupCodesParams> = {
  id: 'backup-codes',
  slug: 'backup-codes',
  name: 'Backup Codes',
  description:
    'Generate N cryptographically random recovery codes for 2FA. Configurable alphabet (base32 / numeric / alphanumeric), code length, and group separator. Pairs with totp-code and hotp-code for enrollment.',
  category: 'create',
  presence: 'both',
  keywords: ['backup', 'codes', '2fa', 'recovery', 'mfa', 'auth', 'random', 'generate'],

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

  defaults: defaultBackupCodesParams,

  paramSchema: {
    count: {
      type: 'number',
      label: 'count',
      help: 'How many recovery codes to generate.',
      min: 1,
      max: 100,
      step: 1,
    },
    codeLength: {
      type: 'number',
      label: 'characters per code',
      min: 4,
      max: 64,
      step: 1,
    },
    alphabet: {
      type: 'enum',
      label: 'alphabet',
      options: [
        { value: 'base32', label: 'base32 (A–Z 2–7) — like TOTP secrets' },
        { value: 'base32-lower', label: 'base32 lowercase' },
        { value: 'numeric', label: 'numeric (0–9) — Steam-style' },
        { value: 'alphanumeric', label: 'alphanumeric (no ambiguous chars)' },
      ],
    },
    groupSize: {
      type: 'number',
      label: 'group size',
      help: 'Insert a separator every N characters. 0 = no grouping.',
      min: 0,
      max: 16,
      step: 1,
    },
    separator: {
      type: 'enum',
      label: 'separator',
      help: 'Used only when group size is > 0.',
      options: [
        { value: '-', label: 'hyphen' },
        { value: ' ', label: 'space' },
        { value: '·', label: 'middle dot' },
      ],
    },
  },

  Component: BackupCodesComponentStub,

  async run(_inputs: File[], params: BackupCodesParams, ctx: ToolRunContext): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Generating codes' });
    const result = generateBackupCodes(params);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
