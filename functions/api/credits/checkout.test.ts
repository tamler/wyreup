import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './checkout';
import { onRequestPost as portal } from './portal';
import { onRequestGet as status } from './status';
import {
  CUSTOMER_ID, MONTHLY_ID, SANDBOX_ORIGIN, TRANSACTION_ID, paddleFixture, paddlePrice, paddleTestId,
} from '../../_lib/test/paddle';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function requestBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected a synthetic JSON request');
  return JSON.parse(init.body) as unknown;
}

describe('Paddle checkout', () => {
  let f: Awaited<ReturnType<typeof paddleFixture>>;

  beforeEach(async () => {
    f = await paddleFixture();
    await f.enableSandbox();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await f.close();
  });

  async function checkout(pack: string, csrf = '1', owner: string | null = 'owner') {
    return onRequestPost(await f.context('/api/credits/checkout', {
      method: 'POST', headers: { 'X-Wyreup-CSRF': csrf },
      body: JSON.stringify({ pack, userId: 'other', quantity: 999 }),
    }, owner ?? undefined));
  }

  function provider(options?: {
    failTransaction?: boolean; badCustomer?: boolean; badPrice?: boolean;
    waitForTransaction?: () => Promise<void>; failCancellation?: boolean;
  }) {
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://sandbox-api.paddle.com');
      if (parsed.pathname.startsWith('/prices/')) {
        const pack = parsed.pathname.endsWith(paddlePrice('monthly').id) ? 'monthly' : 'starter';
        const price = paddlePrice(pack);
        if (options?.badPrice) price.unit_price.amount = '10';
        return Response.json({ data: price });
      }
      if (parsed.pathname === '/customers') {
        const data = { id: CUSTOMER_ID, email: options?.badCustomer ? 'other@example.org' : 'owner@example.org', status: 'active' };
        return Response.json({ data: init.method === 'GET' ? [data] : data });
      }
      if (parsed.pathname === '/transactions') {
        await options?.waitForTransaction?.();
        if (options?.failTransaction) throw new Error('Uncertain test transport');
        const { items } = requestBody(init) as { items: { price_id: string }[] };
        return Response.json({ data: {
          id: items[0].price_id === paddlePrice('monthly').id ? MONTHLY_ID : TRANSACTION_ID,
          status: 'draft', customer_id: CUSTOMER_ID,
        } });
      }
      if (parsed.pathname === `/transactions/${TRANSACTION_ID}` && init.method === 'PATCH') {
        if (options?.failCancellation) return Response.json({ error: {} }, { status: 502 });
        return Response.json({ data: { id: TRANSACTION_ID, status: 'canceled' } });
      }
      throw new Error('Unexpected synthetic Paddle request');
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('creates and resumes one server-owned Paddle transaction', async () => {
    const request = provider();
    const result = await checkout('starter');
    const transaction = request.mock.calls.find(([url]) => url === 'https://sandbox-api.paddle.com/transactions');
    expect(transaction).toBeDefined();
    expect(requestBody(transaction?.[1])).toMatchObject({
      items: [{ price_id: paddlePrice('starter').id, quantity: 1 }], customer_id: CUSTOMER_ID,
      checkout: { url: `${SANDBOX_ORIGIN}/checkout` }, currency_code: 'USD',
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      checkoutUrl: `${SANDBOX_ORIGIN}/checkout?_ptxn=${TRANSACTION_ID}`, transactionId: TRANSACTION_ID,
    });
    expect((await checkout('starter')).status).toBe(200);
    expect(request).toHaveBeenCalledTimes(3);
    expect(await f.db.prepare('SELECT user_id,state,customer_id FROM paddle_checkouts').first())
      .toEqual({ user_id: 'owner', state: 'open', customer_id: CUSTOMER_ID });
  });

  it('preserves auth and CSRF, and refuses checkout when the database mode disagrees', async () => {
    const request = provider();
    expect((await checkout('starter', '1', null)).status).toBe(401);
    expect((await checkout('starter', '')).status).toBe(403);
    f.env.PADDLE_ENVIRONMENT = 'live';
    f.env.PADDLE_CLIENT_TOKEN = 'live_synthetic';
    f.env.PADDLE_API_KEY = 'pdl_live_apikey_synthetic';
    f.env.APP_ORIGIN = 'https://wyreup.com';
    const { request: synthetic, env } = await f.context('/api/credits/checkout', {
      method: 'POST', headers: { 'X-Wyreup-CSRF': '1' }, body: JSON.stringify({ pack: 'starter' }),
    }, 'owner');
    expect((await onRequestPost({ ...await f.context('/'), request: new Request('https://wyreup.com/api/credits/checkout', synthetic), env })).status).toBe(503);
    expect(request).not.toHaveBeenCalled();
    await expect(f.exec("UPDATE paddle_billing_mode SET mode='live'")).rejects.toThrow(/already assigned/);
  });

  it('fails closed on altered prices, buyer identity, and API/client modes', async () => {
    const badPrice = provider({ badPrice: true });
    expect((await checkout('starter')).status).toBe(503);
    expect(badPrice).toHaveBeenCalledTimes(1);
    const badCustomer = provider({ badCustomer: true });
    expect((await checkout('starter')).status).toBe(503);
    expect(badCustomer).toHaveBeenCalledTimes(2);
    f.env.PADDLE_CLIENT_TOKEN = 'live_wrong_mode';
    expect((await checkout('starter')).status).toBe(503);
    expect(badCustomer).toHaveBeenCalledTimes(2);
  });

  it('serializes monthly attempts and reuses the payable transaction', async () => {
    const entered = signal();
    const release = signal();
    const request = provider({ waitForTransaction: () => {
      entered.resolve();
      return release.promise;
    } });
    const original = checkout('monthly');
    try {
      await entered.promise;
      expect((await checkout('monthly')).status).toBe(409);
    } finally {
      release.resolve();
    }
    expect((await original).status).toBe(200);
    expect((await checkout('monthly')).status).toBe(200);
    expect(request.mock.calls.filter(([url]) => url.endsWith('/transactions'))).toHaveLength(1);
  });

  it('preserves the reservation when provider create is uncertain', async () => {
    const request = provider({ failTransaction: true });
    expect((await checkout('monthly')).status).toBe(503);
    expect((await checkout('monthly')).status).toBe(409);
    expect(request.mock.calls.filter(([url]) => url.endsWith('/transactions'))).toHaveLength(1);
    expect(await f.db.prepare('SELECT state FROM paddle_checkouts').first()).toEqual({ state: 'blocked' });
  });

  async function seedInterruptedCheckout(createdAt: number) {
    await f.checkout('monthly');
    await f.db.prepare(`
      UPDATE paddle_checkouts SET state='creating', transaction_id=NULL, created_at=?
    `).bind(createdAt).run();
  }

  it('keeps a fresh intent in progress and marks an interrupted stale intent for reconciliation', async () => {
    const request = provider();
    await seedInterruptedCheckout(Date.now());
    const fresh = await checkout('monthly');
    expect(fresh.status).toBe(409);
    expect(await fresh.json()).toEqual({ error: 'Checkout is being prepared. Try again shortly.' });

    // Paddle may already have created a transaction whose ID never reached D1.
    await f.db.prepare('UPDATE paddle_checkouts SET created_at=?').bind(Date.now() - 121_000).run();
    for (let retry = 0; retry < 2; retry++) {
      const stale = await checkout('monthly');
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ error: 'An earlier checkout needs reconciliation. Contact support.' });
    }
    expect(await f.db.prepare('SELECT state,transaction_id,customer_id FROM paddle_checkouts').first()).toEqual({
      state: 'blocked', transaction_id: null, customer_id: CUSTOMER_ID,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns the exact original transaction if its binding wins the stale-checkout race', async () => {
    const request = provider();
    await seedInterruptedCheckout(Date.now() - 121_000);
    // Simulate the original request binding immediately before the retry's
    // conditional update. RAISE(IGNORE) leaves that competing write intact.
    await f.exec(`
      CREATE TRIGGER original_binding_wins BEFORE UPDATE OF state ON paddle_checkouts
      WHEN NEW.state='blocked' AND OLD.intent_id='${MONTHLY_ID}'
      BEGIN
        UPDATE paddle_checkouts SET state='open', transaction_id='${MONTHLY_ID}'
          WHERE mode=OLD.mode AND intent_id=OLD.intent_id;
        SELECT RAISE(IGNORE);
      END;
    `);
    const result = await checkout('monthly');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      checkoutUrl: `${SANDBOX_ORIGIN}/checkout?_ptxn=${MONTHLY_ID}`, transactionId: MONTHLY_ID,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not expose a late original response when the reconciliation hold wins', async () => {
    const entered = signal();
    const release = signal();
    const request = provider({ waitForTransaction: () => {
      entered.resolve();
      return release.promise;
    } });
    const original = checkout('starter');
    try {
      await entered.promise;
      await f.db.prepare('UPDATE paddle_checkouts SET created_at=?').bind(Date.now() - 121_000).run();
      const blocked = await checkout('starter');
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toEqual({ error: 'An earlier checkout needs reconciliation. Contact support.' });
    } finally {
      release.resolve();
    }
    const result = await original;
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: 'Checkout needs reconciliation. Contact support before retrying.' });
    expect(request.mock.calls.filter(([url, init]) => url.endsWith('/transactions') && init.method === 'POST')).toHaveLength(1);
    expect(await f.db.prepare('SELECT state,transaction_id FROM paddle_checkouts').first()).toEqual({
      state: 'blocked', transaction_id: null,
    });
  });

  it.each([false, true])('recovers failed binding with exact cancellation (failure=%s)', async failCancellation => {
    const request = provider({ failCancellation });
    await f.exec(`CREATE TRIGGER fail_binding BEFORE UPDATE OF state ON paddle_checkouts WHEN NEW.state='open'
      BEGIN SELECT RAISE(ABORT,'synthetic binding failure'); END;`);
    expect((await checkout('starter')).status).toBe(503);
    expect(request.mock.calls.at(-1)?.[0]).toBe(`https://sandbox-api.paddle.com/transactions/${TRANSACTION_ID}`);
    expect(requestBody(request.mock.calls.at(-1)?.[1])).toEqual({ status: 'canceled' });
    expect(await f.db.prepare('SELECT state,transaction_id FROM paddle_checkouts').first()).toEqual({
      state: failCancellation ? 'blocked' : 'cancelled', transaction_id: TRANSACTION_ID,
    });
  });

  it('blocks legacy and Paddle billable plans while allowing one-time purchases', async () => {
    const request = provider();
    await f.exec("UPDATE users SET ls_subscription_id='legacy',subscription_status='paused' WHERE id='owner'");
    expect((await checkout('monthly')).status).toBe(409);
    expect(request).not.toHaveBeenCalled();
    await f.exec("UPDATE users SET subscription_status='expired' WHERE id='owner'");
    await f.db.prepare(`
      INSERT INTO paddle_subscriptions
        (mode,subscription_id,user_id,initial_transaction_id,customer_id,price_id,status,entity_time,status_priority)
      VALUES ('sandbox',?,'owner',?,?,?,'past_due','',3)
    `).bind(paddleTestId('sub', 's'), MONTHLY_ID, CUSTOMER_ID, paddlePrice('monthly').id).run();
    expect((await checkout('monthly')).status).toBe(409);
    expect((await checkout('starter')).status).toBe(200);
  });

  it('keeps status and portal sessions scoped to the verified account and validates the returned host', async () => {
    await f.checkout();
    const path = `/api/credits/status?transactionId=${TRANSACTION_ID}`;
    expect((await status(await f.context(path))).status).toBe(401);
    expect((await status(await f.context(path, {}, 'other'))).status).toBe(404);
    expect(await (await status(await f.context(path, {}, 'owner'))).json()).toEqual({ state: 'open' });

    await f.db.prepare(`
      INSERT INTO paddle_settlements
        (mode,transaction_id,item_id,user_id,customer_id,currency,subtotal,credits)
      VALUES ('sandbox',?,?,'owner',?,'USD',500,220)
    `).bind(TRANSACTION_ID, paddleTestId('txnitm', 'i'), CUSTOMER_ID).run();
    let host = 'https://customer-portal.paddle.com';
    const request = vi.fn((url: string) => {
      expect(url).toBe(`https://sandbox-api.paddle.com/customers/${CUSTOMER_ID}/portal-sessions`);
      return Promise.resolve(Response.json({ data: { customer_id: CUSTOMER_ID, urls: { general: { overview: `${host}/session` } } } }));
    });
    vi.stubGlobal('fetch', request);
    const portalRequest = async (owner: string) => portal(await f.context('/api/credits/portal', {
      method: 'POST', headers: { 'X-Wyreup-CSRF': '1' },
      body: JSON.stringify({ customerId: paddleTestId('ctm', 'other') }),
    }, owner));
    expect((await portalRequest('other')).status).toBe(404);
    expect(request).not.toHaveBeenCalled();
    expect((await portalRequest('owner')).status).toBe(502);
    host = 'https://sandbox-customer-portal.paddle.com';
    expect(await (await portalRequest('owner')).json()).toEqual({ portalUrl: `${host}/session` });
  });
});
