import type { ToolModule, ToolRunContext } from '../../types.js';
import { decodeBase32 } from '../base32/index.js';

export type HotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface HotpCodeParams {
  /** Base32-encoded shared secret. */
  secret?: string;
  /** Counter value to sign. RFC 4226 increments this on every successful auth. */
  counter?: number;
  algorithm?: HotpAlgorithm;
  digits?: 6 | 7 | 8;
}

export const defaultHotpCodeParams: HotpCodeParams = {
  secret: '',
  counter: 0,
  algorithm: 'SHA-1',
  digits: 6,
};

export interface HotpCodeResult {
  algorithm: HotpAlgorithm;
  digits: number;
  counter: number;
  code: string;
}

const HotpCodeComponentStub = (): unknown => null;

function counterBytes(counter: number): Uint8Array {
  // 8-byte big-endian unsigned int. JS bit ops are 32-bit, split halves.
  const bytes = new Uint8Array(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  bytes[0] = (high >>> 24) & 0xff;
  bytes[1] = (high >>> 16) & 0xff;
  bytes[2] = (high >>> 8) & 0xff;
  bytes[3] = high & 0xff;
  bytes[4] = (low >>> 24) & 0xff;
  bytes[5] = (low >>> 16) & 0xff;
  bytes[6] = (low >>> 8) & 0xff;
  bytes[7] = low & 0xff;
  return bytes;
}

export async function generateHotp(
  secret: string,
  counter: number,
  algorithm: HotpAlgorithm,
  digits: number,
): Promise<HotpCodeResult> {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error('HOTP counter must be a non-negative integer.');
  }
  const keyBytes = decodeBase32(secret, false);
  const msg = counterBytes(counter);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyBytes),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg as BufferSource));

  // RFC 4226 §5.3 dynamic truncation.
  const offset = sig[sig.length - 1]! & 0x0f;
  const binCode =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  const code = String(binCode % mod).padStart(digits, '0');

  return { algorithm, digits, counter, code };
}

export const hotpCode: ToolModule<HotpCodeParams> = {
  id: 'hotp-code',
  slug: 'hotp-code',
  name: 'HOTP Code',
  description:
    'Generate an RFC 4226 HOTP code from a base32 secret and an explicit counter. Counter-based sibling of TOTP — same algorithm, just no time slice.',
  category: 'inspect',
  presence: 'both',
  keywords: ['hotp', 'otp', 'rfc4226', 'counter', 'auth', 'mfa', 'one-time'],

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

  defaults: defaultHotpCodeParams,

  paramSchema: {
    secret: {
      type: 'string',
      label: 'base32 secret',
      placeholder: 'JBSWY3DPEHPK3PXP',
    },
    counter: {
      type: 'number',
      label: 'counter',
      help: 'RFC 4226 counter value. Test vectors in the RFC start at 0.',
      min: 0,
      max: 1e15,
      step: 1,
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      options: [
        { value: 'SHA-1', label: 'SHA-1 (default)' },
        { value: 'SHA-256', label: 'SHA-256' },
        { value: 'SHA-512', label: 'SHA-512' },
      ],
    },
    digits: {
      type: 'enum',
      label: 'digits',
      options: [
        { value: 6, label: '6 (standard)' },
        { value: 7, label: '7' },
        { value: 8, label: '8' },
      ],
    },
  },

  Component: HotpCodeComponentStub,

  async run(_inputs: File[], params: HotpCodeParams, ctx: ToolRunContext): Promise<Blob[]> {
    const secret = (params.secret ?? '').trim();
    if (!secret) throw new Error('hotp-code requires a base32 secret.');
    const counter = params.counter ?? 0;
    const algorithm = params.algorithm ?? 'SHA-1';
    const digits = params.digits ?? 6;

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Computing code' });
    const result = await generateHotp(secret, counter, algorithm, digits);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
