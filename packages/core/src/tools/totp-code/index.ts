import type { ToolModule, ToolRunContext } from '../../types.js';
import { decodeBase32 } from '../base32/index.js';

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface TotpCodeParams {
  /** Base32-encoded shared secret. Typed locally, never uploaded. */
  secret?: string;
  /** Hash algorithm. RFC 6238 defaults to SHA-1, which most apps still use. */
  algorithm?: TotpAlgorithm;
  /** Number of digits in the code. Almost always 6; some servers use 8. */
  digits?: 6 | 7 | 8;
  /** Code period in seconds. RFC 6238 default is 30. */
  periodSeconds?: number;
}

export const defaultTotpCodeParams: TotpCodeParams = {
  secret: '',
  algorithm: 'SHA-1',
  digits: 6,
  periodSeconds: 30,
};

export interface TotpCodeResult {
  algorithm: TotpAlgorithm;
  digits: number;
  periodSeconds: number;
  /** Seconds since the Unix epoch used to compute this code (UTC). */
  unixTime: number;
  /** Time-step counter T = floor(unixTime / period). */
  counter: number;
  /** The current TOTP code. */
  code: string;
  /** Seconds remaining before the code rotates. */
  secondsRemaining: number;
}

function counterBytes(counter: number): Uint8Array {
  // RFC 4226: counter is an 8-byte big-endian unsigned integer.
  // JS bitwise ops are 32-bit, so split high/low halves.
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

export async function generateTotp(
  secret: string,
  algorithm: TotpAlgorithm,
  digits: number,
  periodSeconds: number,
  unixTime: number,
): Promise<TotpCodeResult> {
  const keyBytes = decodeBase32(secret, false);
  const counter = Math.floor(unixTime / periodSeconds);
  const msg = counterBytes(counter);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyBytes),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg as BufferSource));

  // Dynamic truncation per RFC 4226 §5.3.
  const offset = sig[sig.length - 1]! & 0x0f;
  const binCode =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  const code = String(binCode % mod).padStart(digits, '0');

  const secondsRemaining = periodSeconds - (unixTime % periodSeconds);

  return {
    algorithm,
    digits,
    periodSeconds,
    unixTime,
    counter,
    code,
    secondsRemaining,
  };
}

export const totpCode: ToolModule<TotpCodeParams> = {
  id: 'totp-code',
  slug: 'totp-code',
  name: 'TOTP Code',
  description:
    'Generate the current RFC 6238 TOTP code from a base32 secret. Compatible with Google Authenticator, Authy, 1Password, and the rest. Nothing leaves your device.',
  category: 'inspect',
  keywords: ['totp', 'otp', '2fa', 'auth', 'mfa', 'authenticator', 'rfc6238', 'rfc4226', 'one-time'],

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

  defaults: defaultTotpCodeParams,

  paramSchema: {
    secret: {
      type: 'string',
      label: 'base32 secret',
      help: 'The shared secret from the issuer (the string under the QR code, e.g. JBSWY3DPEHPK3PXP). Whitespace OK.',
      placeholder: 'JBSWY3DPEHPK3PXP',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      help: 'Almost every TOTP issuer uses SHA-1. Switch only if the issuer says so.',
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
    periodSeconds: {
      type: 'number',
      label: 'period (s)',
      help: 'How long each code is valid. Standard is 30 seconds.',
      min: 5,
      max: 300,
      step: 1,
      unit: 's',
    },
  },

  async run(_inputs: File[], params: TotpCodeParams, ctx: ToolRunContext): Promise<Blob[]> {
    const secret = (params.secret ?? '').trim();
    if (!secret) throw new Error('totp-code requires a base32 secret.');
    const algorithm = params.algorithm ?? 'SHA-1';
    const digits = params.digits ?? 6;
    const periodSeconds = params.periodSeconds ?? 30;
    const unixTime = Math.floor(Date.now() / 1000);

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Computing code' });
    const result = await generateTotp(secret, algorithm, digits, periodSeconds, unixTime);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
