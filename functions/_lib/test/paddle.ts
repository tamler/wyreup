import type { Env } from '../env';
import type { PagesFunctionContext } from '../types';
import { hmacSha256Hex, signSessionCookie } from '../crypto';
import { createSqliteTestDb } from './sqlite';

export const SANDBOX_ORIGIN = 'https://sandbox.example.org';
export const WEBHOOK_SECRET = 'synthetic-webhook-secret';
export const PRICE_IDS = {
  starter: paddleTestId('pri', 'a'),
  standard: paddleTestId('pri', 'b'),
  power: paddleTestId('pri', 'c'),
  monthly: paddleTestId('pri', 'd'),
};
export const CUSTOMER_ID = paddleTestId('ctm', 'c');
export const TRANSACTION_ID = paddleTestId('txn', 't');
export const MONTHLY_ID = paddleTestId('txn', 'm');
export const SUBSCRIPTION_ID = paddleTestId('sub', 's');
export const ITEM_ID = paddleTestId('txnitm', 'i');

export function paddleTestId(prefix: string, suffix: string | number): string {
  return `${prefix}_${String(suffix).padStart(26, '0')}`;
}

export async function paddleFixture(origin = SANDBOX_ORIGIN) {
  const sqlite = await createSqliteTestDb();
  await sqlite.exec(`
    INSERT INTO users(id,email,created_at) VALUES ('owner','owner@example.org',0), ('other','other@example.org',0);
    INSERT INTO api_keys(id,user_id,key_hash,name,created_at,email_bound) VALUES
      ('owner-key','owner','owner-key-hash','Test',0,1), ('other-key','other','other-key-hash','Test',0,1);
  `);
  const env = {
    DB: sqlite.db,
    SESSION_SECRET: 'synthetic-session-secret',
    APP_ORIGIN: origin,
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_API_KEY: 'pdl_sdbx_apikey_synthetic',
    PADDLE_CLIENT_TOKEN: 'test_synthetic',
    PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PADDLE_PRICE_STARTER: PRICE_IDS.starter,
    PADDLE_PRICE_STANDARD: PRICE_IDS.standard,
    PADDLE_PRICE_POWER: PRICE_IDS.power,
    PADDLE_PRICE_MONTHLY: PRICE_IDS.monthly,
    LS_WEBHOOK_SECRET: 'legacy-synthetic-webhook-secret',
    LS_VARIANT_STARTER: '2',
    LS_VARIANT_MONTHLY: '3',
  } as Env;

  function enableSandbox() {
    return sqlite.exec("UPDATE paddle_billing_mode SET mode='sandbox'");
  }
  async function session(userId = 'owner') {
    const signed = await signSessionCookie(
      { uid: userId, kid: `${userId}-key`, exp: Date.now() + 60_000 }, env.SESSION_SECRET,
    );
    return `__Host-wyreup_session=${signed}`;
  }

  async function context(path: string, init: RequestInit = {}, userId?: string) {
    const headers = new Headers(init.headers);
    if (userId) headers.set('Cookie', await session(userId));
    const request = new Request(`${origin}${path}`, { ...init, headers });
    return { request, env } as PagesFunctionContext;
  }

  async function checkout(pack: 'starter' | 'monthly' = 'starter') {
    const id = pack === 'starter' ? TRANSACTION_ID : MONTHLY_ID;
    await sqlite.db.prepare(`
      INSERT INTO paddle_customers (mode,user_id,customer_id) VALUES ('sandbox','owner',?)
      ON CONFLICT(mode,user_id) DO NOTHING
    `).bind(CUSTOMER_ID).run();
    await sqlite.db.prepare(`
      INSERT INTO paddle_checkouts
        (mode,intent_id,user_id,pack,price_id,credits,unit_amount,currency,quantity,state,created_at,customer_id,transaction_id)
      VALUES ('sandbox',?,'owner',?,?,?,?,'USD',1,'open',0,?,?)
    `).bind(
      id, pack, PRICE_IDS[pack], pack === 'starter' ? 220 : 440,
      pack === 'starter' ? 500 : 800, CUSTOMER_ID, id,
    ).run();
    return id;
  }

  return { ...sqlite, env, context, checkout, enableSandbox };
}

export function paddlePrice(pack: 'starter' | 'monthly') {
  return {
    id: PRICE_IDS[pack],
    unit_price: { amount: pack === 'starter' ? '500' : '800', currency_code: 'USD' },
    billing_cycle: pack === 'starter' ? null : { interval: 'month', frequency: 1 },
    trial_period: null,
    quantity: { minimum: 1, maximum: 1 },
    unit_price_overrides: [],
    status: 'active',
  };
}

export async function paddleSignature(body: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `ts=${timestamp};h1=${await hmacSha256Hex(WEBHOOK_SECRET, `${timestamp}:${body}`)}`;
}
