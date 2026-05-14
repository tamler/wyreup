import type { ToolModule, ToolRunContext } from '../../types.js';

export type WebhookReplayAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type WebhookReplayEncoding = 'hex' | 'base64';

export interface WebhookReplayParams {
  /** Signature on the inbound payload. */
  incomingSignature?: string;
  /** Secret the inbound webhook was signed with. */
  incomingSecret?: string;
  /** Secret to re-sign with for replay (e.g. your local dev server). */
  replaySecret?: string;
  algorithm?: WebhookReplayAlgorithm;
  encoding?: WebhookReplayEncoding;
  /** Strip this prefix from `incomingSignature` before comparison (e.g. "sha256="). */
  signaturePrefix?: string;
  /** Prepend this prefix when emitting the replay signature so the receiver sees its expected format. */
  replayPrefix?: string;
}

export const defaultWebhookReplayParams: WebhookReplayParams = {
  incomingSignature: '',
  incomingSecret: '',
  replaySecret: '',
  algorithm: 'SHA-256',
  encoding: 'hex',
  signaturePrefix: '',
  replayPrefix: '',
};

export interface WebhookReplayResult {
  algorithm: WebhookReplayAlgorithm;
  encoding: WebhookReplayEncoding;
  payloadBytes: number;
  /** Did the incoming signature verify? */
  incomingValid: boolean;
  /** Signature recomputed from `incomingSecret` for the audit trail. */
  incomingComputed: string;
  /** What the caller provided, after prefix stripping. */
  incomingProvided: string;
  /** Signature for the same payload under `replaySecret`, ready to forward. */
  replaySignature: string;
  /** Same as replaySignature with `replayPrefix` prepended. */
  replayHeader: string;
}

const WebhookReplayComponentStub = (): unknown => null;

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

async function sign(payload: ArrayBuffer, secret: string, algorithm: WebhookReplayAlgorithm, encoding: WebhookReplayEncoding): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return encoding === 'base64' ? toBase64(sig) : toHex(sig);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const webhookReplay: ToolModule<WebhookReplayParams> = {
  id: 'webhook-replay',
  slug: 'webhook-replay',
  name: 'Webhook Replay',
  description:
    'Verify an inbound webhook then re-sign the same payload under a different secret for replay against your local dev or staging server. The classic "tunnel a Stripe / GitHub webhook through to localhost" pattern, without a server roundtrip.',
  category: 'inspect',
  presence: 'both',
  keywords: ['webhook', 'replay', 'forward', 'tunnel', 'hmac', 'stripe', 'github', 'staging', 'dev'],

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

  defaults: defaultWebhookReplayParams,

  paramSchema: {
    incomingSignature: {
      type: 'string',
      label: 'inbound signature',
      help: 'Value from the original webhook header (e.g. X-Hub-Signature-256: sha256=...).',
      placeholder: 'sha256=...',
    },
    incomingSecret: {
      type: 'string',
      label: 'inbound secret',
      help: 'Secret the provider used to sign. Never uploaded.',
      placeholder: 'whsec_...',
    },
    replaySecret: {
      type: 'string',
      label: 'replay secret',
      help: 'Secret your local / staging server expects. The same payload gets re-signed under this key.',
      placeholder: 'whsec_local',
    },
    algorithm: {
      type: 'enum',
      label: 'algorithm',
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
        { value: 'base64', label: 'base64 (Slack, others)' },
      ],
    },
    signaturePrefix: {
      type: 'string',
      label: 'inbound prefix',
      help: 'Strip this prefix from the inbound signature before comparison.',
      placeholder: 'sha256=',
    },
    replayPrefix: {
      type: 'string',
      label: 'replay prefix',
      help: 'Prepended to the new signature in `replayHeader` so the receiver sees its expected format.',
      placeholder: 'sha256=',
    },
  },

  Component: WebhookReplayComponentStub,

  async run(inputs: File[], params: WebhookReplayParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('webhook-replay needs exactly one payload file.');
    const incomingSignature = (params.incomingSignature ?? '').trim();
    if (!incomingSignature) throw new Error('webhook-replay requires the inbound signature.');
    const incomingSecret = params.incomingSecret ?? '';
    if (!incomingSecret) throw new Error('webhook-replay requires the inbound secret.');
    const replaySecret = params.replaySecret ?? '';
    if (!replaySecret) throw new Error('webhook-replay requires a replay secret (otherwise just use webhook-verify).');

    const algorithm = params.algorithm ?? 'SHA-256';
    const encoding = params.encoding ?? 'hex';
    const inPrefix = (params.signaturePrefix ?? '').trim();
    const outPrefix = (params.replayPrefix ?? '').trim();

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading payload' });
    const payload = await inputs[0]!.arrayBuffer();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Verifying inbound' });
    const incomingComputed = await sign(payload, incomingSecret, algorithm, encoding);
    const stripped = inPrefix && incomingSignature.startsWith(inPrefix)
      ? incomingSignature.slice(inPrefix.length)
      : incomingSignature;
    const a = encoding === 'hex' ? incomingComputed.toLowerCase() : incomingComputed;
    const b = encoding === 'hex' ? stripped.toLowerCase() : stripped;
    const incomingValid = constantTimeEqual(a, b);

    ctx.onProgress({ stage: 'processing', percent: 85, message: 'Re-signing for replay' });
    const replaySignature = await sign(payload, replaySecret, algorithm, encoding);

    const result: WebhookReplayResult = {
      algorithm,
      encoding,
      payloadBytes: payload.byteLength,
      incomingValid,
      incomingComputed,
      incomingProvided: stripped,
      replaySignature,
      replayHeader: outPrefix ? `${outPrefix}${replaySignature}` : replaySignature,
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
