import type { ToolModule, ToolRunContext } from '../../types.js';

export interface LicenseKeyParams {
  /** Characters per group. */
  groupSize?: number;
  /** Number of groups. */
  groupCount?: number;
  /** Separator between groups. */
  separator?: '-' | ' ' | '·';
  /** How many keys to generate. */
  count?: number;
  /** Use Crockford-style alphabet (no 0/O/I/L/1) to keep keys phone-friendly. */
  unambiguous?: boolean;
}

export const defaultLicenseKeyParams: LicenseKeyParams = {
  groupSize: 5,
  groupCount: 5,
  separator: '-',
  count: 1,
  unambiguous: true,
};

export interface LicenseKeyResult {
  groupSize: number;
  groupCount: number;
  entropyBits: number;
  keys: string[];
}

const ALPHABET_FULL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALPHABET_UNAMBIGUOUS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomKey(groupSize: number, groupCount: number, separator: string, alphabet: string): string {
  const totalChars = groupSize * groupCount;
  const len = alphabet.length;
  const maxValid = 256 - (256 % len);
  const out: string[] = [];
  let pool = new Uint8Array(totalChars * 2);
  crypto.getRandomValues(pool);
  let pi = 0;
  let buf = '';
  while (out.length * groupSize + buf.length < totalChars) {
    if (pi >= pool.length) {
      pool = new Uint8Array(totalChars * 2);
      crypto.getRandomValues(pool);
      pi = 0;
    }
    const b = pool[pi++]!;
    if (b < maxValid) {
      buf += alphabet[b % len];
      if (buf.length === groupSize) {
        out.push(buf);
        buf = '';
      }
    }
  }
  return out.join(separator);
}

export const licenseKey: ToolModule<LicenseKeyParams> = {
  id: 'license-key',
  slug: 'license-key',
  name: 'License Key',
  description:
    'Generate Microsoft-style license keys — grouped uppercase alphanumeric with hyphens. Default 5×5 = 25 characters. Crockford-style alphabet (no 0/O/I/L/1) so keys are unambiguous when read aloud.',
  category: 'create',
  keywords: ['license', 'key', 'serial', 'product-key', 'generate', 'random'],

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

  defaults: defaultLicenseKeyParams,

  paramSchema: {
    groupSize: {
      type: 'number',
      label: 'group size',
      min: 3,
      max: 10,
      step: 1,
    },
    groupCount: {
      type: 'number',
      label: 'group count',
      min: 2,
      max: 10,
      step: 1,
    },
    separator: {
      type: 'enum',
      label: 'separator',
      options: [
        { value: '-', label: 'hyphen (Microsoft / Adobe style)' },
        { value: ' ', label: 'space' },
        { value: '·', label: 'middle dot' },
      ],
    },
    unambiguous: {
      type: 'boolean',
      label: 'unambiguous alphabet',
      help: 'Skip 0 / O / I / L / 1 so the key reads cleanly over the phone.',
    },
    count: {
      type: 'number',
      label: 'count',
      min: 1,
      max: 100,
      step: 1,
    },
  },

  async run(_inputs: File[], params: LicenseKeyParams, ctx: ToolRunContext): Promise<Blob[]> {
    const groupSize = Math.max(3, Math.min(10, params.groupSize ?? 5));
    const groupCount = Math.max(2, Math.min(10, params.groupCount ?? 5));
    const separator = params.separator ?? '-';
    const unambiguous = params.unambiguous ?? true;
    const count = Math.max(1, Math.min(100, params.count ?? 1));
    const alphabet = unambiguous ? ALPHABET_UNAMBIGUOUS : ALPHABET_FULL;

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Generating keys' });
    const keys: string[] = [];
    for (let i = 0; i < count; i++) keys.push(randomKey(groupSize, groupCount, separator, alphabet));

    const result: LicenseKeyResult = {
      groupSize,
      groupCount,
      entropyBits: Math.round(groupSize * groupCount * Math.log2(alphabet.length) * 100) / 100,
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
