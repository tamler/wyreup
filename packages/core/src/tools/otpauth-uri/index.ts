import type { ToolModule, ToolRunContext } from '../../types.js';
import { decodeBase32 } from '../base32/index.js';

export type OtpType = 'totp' | 'hotp';
export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface OtpauthUriParams {
  type?: OtpType;
  /** Base32-encoded shared secret. Required. */
  secret?: string;
  /** Account label, e.g. "alice@example.com". Required. */
  account?: string;
  /** Issuer name, e.g. "Wyreup". Recommended — most authenticator apps group by it. */
  issuer?: string;
  algorithm?: OtpAlgorithm;
  digits?: 6 | 7 | 8;
  /** TOTP only — code lifetime in seconds. */
  period?: number;
  /** HOTP only — starting counter value. */
  counter?: number;
  /** Also render a scannable QR PNG alongside the URI. */
  emitQr?: boolean;
  qrSize?: number;
}

export const defaultOtpauthUriParams: OtpauthUriParams = {
  type: 'totp',
  secret: '',
  account: '',
  issuer: '',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  counter: 0,
  emitQr: true,
  qrSize: 300,
};

export interface OtpauthUriResult {
  uri: string;
  type: OtpType;
  label: string;
  parameters: Record<string, string>;
}

export function buildOtpauthUri(params: OtpauthUriParams): OtpauthUriResult {
  const type = params.type ?? 'totp';
  const secret = (params.secret ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!secret) throw new Error('otpauth-uri requires a base32 secret.');
  // Validate the secret decodes as base32 — protects against typos that
  // produce an unusable QR.
  try {
    decodeBase32(secret, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Secret is not valid base32: ${msg}`);
  }

  const account = (params.account ?? '').trim();
  if (!account) throw new Error('otpauth-uri requires an account label.');
  const issuer = (params.issuer ?? '').trim();

  // Per the Google Authenticator key-uri-format spec, the label is
  // "Issuer:Account" — the issuer is duplicated as a query param so
  // older clients without label-parsing still group correctly.
  const label = issuer ? `${issuer}:${account}` : account;

  const algorithm = params.algorithm ?? 'SHA1';
  const digits = params.digits ?? 6;

  const parameters: Record<string, string> = { secret };
  if (issuer) parameters.issuer = issuer;
  if (algorithm !== 'SHA1') parameters.algorithm = algorithm;
  if (digits !== 6) parameters.digits = String(digits);
  if (type === 'totp') {
    const period = params.period ?? 30;
    if (period !== 30) parameters.period = String(period);
  } else {
    parameters.counter = String(params.counter ?? 0);
  }

  const queryParts: string[] = [];
  for (const [k, v] of Object.entries(parameters)) {
    queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  const uri = `otpauth://${type}/${encodeURIComponent(label)}?${queryParts.join('&')}`;

  return { uri, type, label, parameters };
}

export const otpauthUri: ToolModule<OtpauthUriParams> = {
  id: 'otpauth-uri',
  slug: 'otpauth-uri',
  name: 'otpauth URI',
  description:
    'Build an otpauth:// enrollment URI for Google Authenticator / 1Password / Authy / Bitwarden. Optionally renders a scannable QR alongside the URI — drop in secret + issuer + account, get the QR to point your phone at.',
  category: 'create',
  keywords: ['otpauth', 'totp', 'hotp', '2fa', 'mfa', 'qr', 'enrollment', 'authenticator', 'google'],

  input: {
    accept: ['*/*'],
    min: 0,
    sizeLimit: 0,
  },
  output: {
    mime: 'application/json',
    multiple: true,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultOtpauthUriParams,

  paramSchema: {
    type: {
      type: 'enum',
      label: 'type',
      options: [
        { value: 'totp', label: 'totp — time-based (standard)' },
        { value: 'hotp', label: 'hotp — counter-based' },
      ],
    },
    secret: {
      type: 'string',
      label: 'base32 secret',
      help: 'The same shared secret you\'ll use for totp-code / hotp-code.',
      placeholder: 'JBSWY3DPEHPK3PXP',
    },
    account: {
      type: 'string',
      label: 'account',
      help: 'Identifier shown under the issuer in authenticator apps.',
      placeholder: 'alice@example.com',
    },
    issuer: {
      type: 'string',
      label: 'issuer',
      help: 'Service name. Most apps group entries by issuer.',
      placeholder: 'Wyreup',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      help: 'Only SHA1 is universally supported across authenticator apps.',
      options: [
        { value: 'SHA1', label: 'SHA1 (default — universal)' },
        { value: 'SHA256', label: 'SHA256' },
        { value: 'SHA512', label: 'SHA512' },
      ],
    },
    digits: {
      type: 'enum',
      label: 'digits',
      options: [
        { value: 6, label: '6 (default)' },
        { value: 7, label: '7' },
        { value: 8, label: '8' },
      ],
    },
    period: {
      type: 'number',
      label: 'period (s)',
      help: 'TOTP only.',
      min: 5,
      max: 300,
      step: 1,
      unit: 's',
      showWhen: { field: 'type', equals: 'totp' },
    },
    counter: {
      type: 'number',
      label: 'counter',
      help: 'HOTP only — starting counter value.',
      min: 0,
      max: 1e15,
      step: 1,
      showWhen: { field: 'type', equals: 'hotp' },
    },
    emitQr: {
      type: 'boolean',
      label: 'render QR',
      help: 'Produce a scannable QR PNG alongside the URI.',
    },
    qrSize: {
      type: 'number',
      label: 'QR size',
      min: 100,
      max: 1000,
      step: 50,
      unit: 'px',
    },
  },

  async run(_inputs: File[], params: OtpauthUriParams, ctx: ToolRunContext): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Building URI' });
    const result = buildOtpauthUri(params);
    const outputs: Blob[] = [
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    ];

    if (params.emitQr ?? true) {
      ctx.onProgress({ stage: 'processing', percent: 70, message: 'Rendering QR' });
      const QRCode = await import('qrcode');
      if (ctx.signal.aborted) throw new Error('Aborted');
      const buffer = await QRCode.toBuffer(result.uri, {
        errorCorrectionLevel: 'M',
        width: params.qrSize ?? 300,
      });
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      outputs.push(new Blob([arrayBuffer], { type: 'image/png' }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json', 'image/png'],
  },
};
