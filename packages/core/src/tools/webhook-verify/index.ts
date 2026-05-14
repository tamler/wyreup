import type { ToolModule, ToolRunContext } from '../../types.js';

export type WebhookAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type WebhookEncoding = 'hex' | 'base64';

export interface WebhookVerifyParams {
  /** Provided signature from the webhook header. Hex or base64. */
  signature?: string;
  /** Shared secret. */
  secret?: string;
  algorithm?: WebhookAlgorithm;
  encoding?: WebhookEncoding;
  /** Optional prefix the provider attaches (e.g. "sha256=" for GitHub). Stripped before comparison. */
  signaturePrefix?: string;
}

export const defaultWebhookVerifyParams: WebhookVerifyParams = {
  signature: '',
  secret: '',
  algorithm: 'SHA-256',
  encoding: 'hex',
  signaturePrefix: '',
};

export interface WebhookVerifyResult {
  valid: boolean;
  algorithm: WebhookAlgorithm;
  encoding: WebhookEncoding;
  /** What we computed from the payload + secret. */
  expected: string;
  /** What the caller provided, after prefix stripping. */
  provided: string;
  /** Bytes of payload that were signed. */
  payloadBytes: number;
}

const WebhookVerifyComponentStub = (): unknown => null;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * Constant-time string comparison. Returns false immediately if the
 * lengths differ (length isn't secret — a smaller signature means it's
 * the wrong algorithm). Otherwise XOR every char and accumulate; that
 * keeps the comparison independent of where the first mismatch is.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const webhookVerify: ToolModule<WebhookVerifyParams> = {
  id: 'webhook-verify',
  slug: 'webhook-verify',
  name: 'Webhook Verify',
  description:
    'Verify a webhook signature against its payload using HMAC. Matches the Stripe / GitHub / Slack convention (HMAC-SHA256 with hex digest). Constant-time compare so timing attacks can\'t lift the signature.',
  category: 'inspect',
  presence: 'both',
  keywords: ['webhook', 'verify', 'hmac', 'signature', 'stripe', 'github', 'slack', 'security'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultWebhookVerifyParams,

  paramSchema: {
    signature: {
      type: 'string',
      label: 'provided signature',
      help: 'The value from the webhook header (e.g. X-Hub-Signature-256: sha256=...).',
      placeholder: 'sha256=abcdef...',
    },
    secret: {
      type: 'string',
      label: 'secret',
      help: 'The shared signing secret. Never uploaded.',
      placeholder: 'whsec_...',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
      help: 'GitHub / Stripe use SHA-256. Slack v0 uses SHA-256. Legacy GitHub v1 uses SHA-1.',
      options: [
        { value: 'SHA-256', label: 'SHA-256 (GitHub, Stripe, Slack)' },
        { value: 'SHA-1', label: 'SHA-1 (legacy GitHub)' },
        { value: 'SHA-384', label: 'SHA-384' },
        { value: 'SHA-512', label: 'SHA-512' },
      ],
    },
    encoding: {
      type: 'enum',
      label: 'signature encoding',
      options: [
        { value: 'hex', label: 'hex (GitHub, Stripe)' },
        { value: 'base64', label: 'base64 (Slack, some others)' },
      ],
    },
    signaturePrefix: {
      type: 'string',
      label: 'prefix to strip',
      help: 'Common providers prefix the signature (e.g. "sha256="). Strip it before comparison.',
      placeholder: 'sha256=',
    },
  },

  Component: WebhookVerifyComponentStub,

  async run(inputs: File[], params: WebhookVerifyParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('webhook-verify needs exactly one payload file.');
    const provided = (params.signature ?? '').trim();
    if (!provided) throw new Error('webhook-verify requires a signature.');
    const secret = params.secret ?? '';
    if (!secret) throw new Error('webhook-verify requires a secret.');
    const algorithm = params.algorithm ?? 'SHA-256';
    const encoding = params.encoding ?? 'hex';
    const prefix = (params.signaturePrefix ?? '').trim();

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading payload' });
    const payload = await inputs[0]!.arrayBuffer();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Computing HMAC' });
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, payload));
    const expected = encoding === 'base64' ? toBase64(sig) : toHex(sig);

    const stripped = prefix && provided.startsWith(prefix) ? provided.slice(prefix.length) : provided;
    // Hex compare is case-insensitive; normalize before constant-time check.
    const a = encoding === 'hex' ? expected.toLowerCase() : expected;
    const b = encoding === 'hex' ? stripped.toLowerCase() : stripped;

    const result: WebhookVerifyResult = {
      valid: constantTimeEqual(a, b),
      algorithm,
      encoding,
      expected,
      provided: stripped,
      payloadBytes: payload.byteLength,
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
