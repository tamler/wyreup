import type { Env } from './env';

export const PACKS = {
  starter: { credits: 220, cents: 500, priceKey: 'PADDLE_PRICE_STARTER' },
  standard: { credits: 480, cents: 1000, priceKey: 'PADDLE_PRICE_STANDARD' },
  power: { credits: 1000, cents: 2000, priceKey: 'PADDLE_PRICE_POWER' },
  monthly: { credits: 440, cents: 800, priceKey: 'PADDLE_PRICE_MONTHLY' },
} as const;

export type Pack = keyof typeof PACKS;
export type PaddleMode = 'sandbox' | 'live';
export interface PaddleConfig {
  mode: PaddleMode;
  origin: string;
  api: string;
  portalOrigin: string;
  apiKey: string;
  clientToken: string;
  webhookSecret: string;
  prices: ReadonlyMap<Pack, string>;
}

export const BILLABLE = "('active', 'trialing', 'past_due', 'paused')";
export const LEGACY_MONTHLY_CLEAR = `(subscription_status IN ('cancelled', 'expired')
  OR (ls_subscription_id IS NULL AND subscription_status IS NULL))`;
const PRODUCTION_HOSTS = new Set(['wyreup.com', 'www.wyreup.com', 'wyreup.pages.dev']);

export function isPack(value: unknown): value is Pack {
  return typeof value === 'string' && Object.hasOwn(PACKS, value);
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function paddleId(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value);
}

export async function billingConfig(env: Env, request: Request): Promise<PaddleConfig | null> {
  const mode = env.PADDLE_ENVIRONMENT;
  if (mode !== 'sandbox' && mode !== 'live') return null;
  const sandbox = mode === 'sandbox';
  const apiKey = env.PADDLE_API_KEY;
  const clientToken = env.PADDLE_CLIENT_TOKEN;
  const webhookSecret = env.PADDLE_WEBHOOK_SECRET;
  if (!apiKey?.startsWith(sandbox ? 'pdl_sdbx_apikey_' : 'pdl_live_apikey_')
    || !clientToken || !/^(?:test|live)_[A-Za-z0-9_]+$/.test(clientToken)
    || !clientToken.startsWith(sandbox ? 'test_' : 'live_')
    || !webhookSecret || !env.APP_ORIGIN) return null;

  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN) return null;
  if (sandbox) {
    if (PRODUCTION_HOSTS.has(url.hostname) || url.hostname.endsWith('.wyreup.pages.dev')) return null;
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
  } else if (url.origin !== 'https://wyreup.com') {
    return null;
  }

  const prices = new Map<Pack, string>();
  for (const pack of Object.keys(PACKS).filter(isPack)) {
    const price = env[PACKS[pack].priceKey];
    if (!paddleId(price, 'pri')) return null;
    prices.set(pack, price);
  }
  if (new Set(prices.values()).size !== prices.size) return null;

  const marker = await env.DB.prepare('SELECT mode FROM paddle_billing_mode WHERE id=1')
    .first<{ mode: string }>();
  if (marker?.mode !== mode) return null;
  return {
    mode,
    origin: url.origin,
    api: sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com',
    portalOrigin: sandbox ? 'https://sandbox-customer-portal.paddle.com' : 'https://customer-portal.paddle.com',
    apiKey,
    clientToken,
    webhookSecret,
    prices,
  };
}

export function safeUrl(value: unknown, origin: string): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export const PAYLOAD_LIMIT = 64 * 1024;
export class PayloadTooLarge extends Error {}

export async function boundedBody(message: Request | Response): Promise<Uint8Array<ArrayBuffer>> {
  const length = message.headers.get('Content-Length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > PAYLOAD_LIMIT) {
    await message.body?.cancel().catch(() => {});
    throw new PayloadTooLarge();
  }
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  const bytes = new Uint8Array(PAYLOAD_LIMIT);
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return bytes.subarray(0, size);
      if (size + chunk.value.length > PAYLOAD_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new PayloadTooLarge();
      }
      bytes.set(chunk.value, size);
      size += chunk.value.length;
    }
  } finally {
    reader.releaseLock();
  }
}

export function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

export async function paddleFetch(
  config: PaddleConfig, path: string, method: 'GET' | 'POST' | 'PATCH', body?: object,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${config.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Paddle-Version': '1',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  const payload = object(decodeJson(await boundedBody(response)));
  return { ok: response.ok, status: response.status, payload };
}

export function matchesPrice(price: Record<string, unknown>, pack: Pack, priceId: string): boolean {
  const cycle = object(price.billing_cycle);
  const unit = object(price.unit_price);
  return price.id === priceId && unit.currency_code === 'USD'
    && unit.amount === String(PACKS[pack].cents) && price.trial_period === null
    && (pack === 'monthly'
      ? cycle.interval === 'month' && cycle.frequency === 1
      : price.billing_cycle === null);
}
