import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost } from './paddle';
import { onRequestPost as legacy } from './lemonsqueezy';
import { onRequestGet as balance } from '../account/balance';
import { hmacSha256Hex } from '../../_lib/crypto';
import { PAYLOAD_LIMIT } from '../../_lib/paddle';
import {
  CUSTOMER_ID, ITEM_ID, MONTHLY_ID, SUBSCRIPTION_ID, TRANSACTION_ID, WEBHOOK_SECRET,
  paddleFixture, paddlePrice, paddleSignature, paddleTestId,
} from '../../_lib/test/paddle';

const EARLY = '2026-11-18T01:00:00.000000Z';
const LATE = '2026-11-18T01:00:00.000001Z';

function payment(
  pack: 'starter' | 'monthly' = 'starter',
  id = pack === 'starter' ? TRANSACTION_ID : MONTHLY_ID,
  origin = 'api',
) {
  const price = paddlePrice(pack);
  const item = { quantity: 1, price, proration: null };
  const totals = { subtotal: price.unit_price.amount, total: price.unit_price.amount, discount: '0' };
  return {
    id, origin, status: 'completed', customer_id: CUSTOMER_ID, collection_mode: 'automatic',
    currency_code: 'USD', subscription_id: pack === 'monthly' ? SUBSCRIPTION_ID : null,
    custom_data: { userId: 'other' },
    items: [item],
    details: {
      totals: { ...totals, credit: '0', grand_total: totals.subtotal, balance: '0' },
      line_items: [{ id: ITEM_ID, price_id: price.id, quantity: 1, proration: null, totals }],
    },
  };
}

function adjustment(
  id: number,
  subtotal: number,
  options: { action?: string; status?: string; time?: string; item?: string; txn?: string } = {},
) {
  return {
    id: paddleTestId('adj', id), action: options.action ?? 'refund', status: options.status ?? 'approved',
    type: 'partial', transaction_id: options.txn ?? TRANSACTION_ID, customer_id: CUSTOMER_ID,
    currency_code: 'USD', totals: { subtotal: String(subtotal) },
    items: [{ item_id: options.item ?? ITEM_ID, totals: { subtotal: String(subtotal) } }],
    updated_at: options.time ?? EARLY,
  };
}

function subscription(status: string, created: boolean, time = EARLY) {
  return {
    id: SUBSCRIPTION_ID, collection_mode: 'automatic', currency_code: 'USD', customer_id: CUSTOMER_ID,
    items: [{ quantity: 1, price: paddlePrice('monthly') }],
    status, updated_at: time,
    ...(created ? { transaction_id: MONTHLY_ID } : {}),
  };
}

describe('Paddle credits and adjustments', () => {
  let f: Awaited<ReturnType<typeof paddleFixture>>;

  beforeEach(async () => {
    f = await paddleFixture();
    await f.enableSandbox();
  });

  afterEach(async () => {
    await f.close();
  });

  function wire(type: string, id: number, data: object) {
    return JSON.stringify({ event_type: type, event_id: paddleTestId('evt', id), occurred_at: LATE, data });
  }

  async function sendRaw(body: string | Uint8Array<ArrayBuffer>, signature?: string) {
    const header = signature ?? await paddleSignature(String(body));
    return onRequestPost(await f.context('/api/webhooks/paddle', {
      method: 'POST', headers: { 'Paddle-Signature': header }, body,
    }));
  }

  async function send(type: string, id: number, data: object) {
    return (await sendRaw(wire(type, id, data))).status;
  }

  async function ledger() {
    return (await f.db.prepare(`
      SELECT user_id,kind,amount FROM credit_events ORDER BY rowid
    `).all()).results;
  }

  it('authenticates exact raw bytes, accepts a rotating signature and rejects stale, future and oversized deliveries', async () => {
    const body = wire('transaction.paid', 1, { id: TRANSACTION_ID });
    const signature = await paddleSignature(body);
    expect((await sendRaw(body, `${signature};h1=${'0'.repeat(64)}`)).status).toBe(200);
    expect((await sendRaw(body + '\n', signature)).status).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    expect((await sendRaw(body, await paddleSignature(body, now - 10))).status).toBe(401);
    expect((await sendRaw(body, await paddleSignature(body, now + 10))).status).toBe(401);
    expect((await sendRaw(body, `${signature};ts=${now}`)).status).toBe(401);
    expect((await sendRaw(new Uint8Array(PAYLOAD_LIMIT + 1), signature)).status).toBe(413);

    const prefix = new TextEncoder().encode(`${now}:`);
    const invalid = Uint8Array.of(...prefix, 0xff);
    const matching = await hmacSha256Hex(WEBHOOK_SECRET, invalid);
    expect((await sendRaw(Uint8Array.of(0xff), `ts=${now};h1=${matching}`)).status).toBe(400);
    expect(await ledger()).toEqual([]);
  });

  it('credits the immutable owner once across concurrent deliveries and rejects conflicting event IDs', async () => {
    await f.checkout();
    const payload = payment();
    expect(await Promise.all([
      send('transaction.completed', 1, payload),
      send('transaction.completed', 1, payload),
      send('transaction.completed', 2, payload),
    ])).toEqual([200, 200, 200]);
    expect(await ledger()).toEqual([{ user_id: 'owner', kind: 'purchase', amount: 220 }]);
    expect(await send('transaction.completed', 1, { ...payload, custom_data: {} })).toBe(409);
    expect(await f.db.prepare('SELECT state FROM paddle_checkouts').first()).toEqual({ state: 'fulfilled' });
  });

  it('rejects unbound customer, modified quantity or price, and ignores non-renewal transaction origins', async () => {
    await f.checkout();
    const paid = payment();
    expect(await send('transaction.completed', 1, { ...paid, customer_id: paddleTestId('ctm', 'other') })).toBe(409);
    expect(await send('transaction.completed', 2, { ...paid, items: [{ ...paid.items[0], quantity: 2 }] })).toBe(409);
    expect(await send('transaction.completed', 3, { ...paid, items: [{
      ...paid.items[0], price: { ...paid.items[0].price, unit_price: { amount: '1', currency_code: 'USD' } },
    }] })).toBe(409);
    expect(await send('transaction.completed', 4, { ...paid, origin: 'subscription_payment_method_change' })).toBe(200);
    expect(await send('transaction.completed', 5, { ...paid, id: paddleTestId('txn', 'unbound') })).toBe(503);
    expect(await send('transaction.completed', 6, { ...paid, details: {
      ...paid.details, totals: { ...paid.details.totals, grand_total: '1' },
    } })).toBe(409);
    expect(await ledger()).toEqual([]);
  });

  it('commits event receipt, settlement, grant and checkout state together and can retry rollback', async () => {
    await f.checkout();
    await f.exec(`CREATE TRIGGER fail_billing_ledger BEFORE INSERT ON credit_events
      BEGIN SELECT RAISE(ABORT,'synthetic ledger failure'); END;`);
    expect(await send('transaction.completed', 1, payment())).toBe(503);
    expect(await f.db.prepare('SELECT COUNT(*) AS n FROM paddle_events').first()).toEqual({ n: 0 });
    expect(await f.db.prepare('SELECT COUNT(*) AS n FROM paddle_settlements').first()).toEqual({ n: 0 });
    expect(await f.db.prepare('SELECT state FROM paddle_checkouts').first()).toEqual({ state: 'open' });
    await f.exec('DROP TRIGGER fail_billing_ledger');
    expect(await send('transaction.completed', 1, payment())).toBe(200);
    expect(await ledger()).toEqual([{ user_id: 'owner', kind: 'purchase', amount: 220 }]);
  });

  it('stages approved partial refunds before fulfillment, ignores tax/other items, and keeps reducer independent of spend', async () => {
    await f.checkout();
    expect(await send('adjustment.updated', 1, adjustment(2, 125, { time: LATE }))).toBe(200);
    expect(await send('adjustment.created', 2, adjustment(2, 125, { status: 'pending_approval' }))).toBe(200);
    expect(await send('adjustment.created', 3, adjustment(3, 0))).toBe(200);
    expect(await send('adjustment.created', 4, adjustment(4, 500, { item: paddleTestId('txnitm', 'other') }))).toBe(200);
    expect(await ledger()).toEqual([]);
    expect(await send('transaction.completed', 5, payment())).toBe(200);
    await f.exec("INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('spent','owner','spend',-165,0)");
    expect(await send('adjustment.created', 6, adjustment(5, 125))).toBe(200);
    expect(await ledger()).toEqual([
      { user_id: 'owner', kind: 'purchase', amount: 220 },
      { user_id: 'owner', kind: 'refund', amount: -55 },
      { user_id: 'owner', kind: 'spend', amount: -165 },
      { user_id: 'owner', kind: 'refund', amount: -55 },
    ]);
    expect(await f.db.prepare("SELECT SUM(amount) AS balance FROM credit_events WHERE user_id='owner'").first())
      .toEqual({ balance: -55 });
  });

  it('keeps cumulative reversals capped to their underlying debit even when delivered first', async () => {
    await f.checkout();
    expect(await send('transaction.completed', 1, payment())).toBe(200);
    expect(await send('adjustment.created', 2, adjustment(1, -500, { action: 'chargeback_reverse' }))).toBe(200);
    expect(await send('adjustment.created', 3, adjustment(2, 500, { action: 'chargeback_warning' }))).toBe(200);
    expect(await send('adjustment.created', 4, adjustment(3, 125))).toBe(200);
    expect(await send('adjustment.created', 5, adjustment(4, 500, { action: 'chargeback' }))).toBe(200);
    expect(await send('adjustment.updated', 6, adjustment(4, 500, { action: 'chargeback', status: 'reversed', time: LATE }))).toBe(200);
    expect(await ledger()).toEqual([
      { user_id: 'owner', kind: 'purchase', amount: 220 }, { user_id: 'owner', kind: 'refund', amount: -55 },
    ]);
    expect(await send('adjustment.created', 7, adjustment(5, 500, { action: 'chargeback' }))).toBe(200);
    expect(await send('adjustment.created', 8, adjustment(6, 500, { action: 'chargeback_reverse' }))).toBe(200);
    expect(await ledger()).toEqual([
      { user_id: 'owner', kind: 'purchase', amount: 220 }, { user_id: 'owner', kind: 'refund', amount: -55 },
      { user_id: 'owner', kind: 'refund', amount: -165 }, { user_id: 'owner', kind: 'refund', amount: 165 },
    ]);
  });

  it('serializes overlapping adjustments and rounds the pooled amount once', async () => {
    await f.checkout();
    expect(await send('transaction.completed', 1, payment())).toBe(200);
    expect(await Promise.all([
      send('adjustment.created', 2, adjustment(1, 1)),
      send('adjustment.created', 3, adjustment(2, 1)),
      send('adjustment.created', 3, adjustment(2, 1)),
    ])).toEqual([200, 200, 200]);
    expect(await f.db.prepare('SELECT SUM(amount) AS balance FROM credit_events').first()).toEqual({ balance: 219 });
    expect(await send('adjustment.created', 4, adjustment(3, 500))).toBe(200);
    expect(await send('adjustment.created', 5, adjustment(4, 500))).toBe(200);
    expect(await f.db.prepare('SELECT SUM(amount) AS balance FROM credit_events').first()).toEqual({ balance: 0 });
  });

  it.each([true, false])('links initial monthly owner regardless of delivery order (created first=%s)', async firstCreated => {
    await f.checkout('monthly');
    const renewal = payment('monthly', paddleTestId('txn', 'renewal'), 'subscription_recurring');
    expect(await send('transaction.completed', 1, renewal)).toBe(503);
    expect(await send('subscription.canceled', 2, subscription('canceled', false, LATE))).toBe(200);
    if (firstCreated) {
      expect(await send('subscription.created', 3, subscription('active', true))).toBe(200);
      expect(await ledger()).toEqual([]);
    }
    expect(await send('transaction.completed', 4, payment('monthly'))).toBe(200);
    if (!firstCreated) expect(await send('subscription.created', 3, subscription('active', true))).toBe(200);
    expect(await send('subscription.activated', 5, subscription('active', false, LATE))).toBe(200);
    expect(await send('transaction.completed', 1, renewal)).toBe(200);
    expect(await send('transaction.completed', 6, renewal)).toBe(200);
    expect(await ledger()).toEqual([
      { user_id: 'owner', kind: 'subscription_grant', amount: 440 },
      { user_id: 'owner', kind: 'subscription_grant', amount: 440 },
    ]);
    expect(await f.db.prepare('SELECT status,user_id FROM paddle_subscriptions').first()).toEqual({ status: 'cancelled', user_id: 'owner' });
  });

  it('preserves existing legacy balances and handles old provider renewals and refunds independently', async () => {
    await f.checkout('monthly');
    expect(await send('transaction.completed', 1, payment('monthly'))).toBe(200);
    async function legacyEvent(event: string, id: string, attributes: object) {
      const body = JSON.stringify({
        meta: { event_name: event, custom_data: { userId: 'owner' } }, data: { id, attributes },
      });
      const signature = await hmacSha256Hex(f.env.LS_WEBHOOK_SECRET, body);
      return (await legacy(await f.context('/api/webhooks/lemonsqueezy', {
        method: 'POST', headers: { 'X-Signature': signature }, body,
      }))).status;
    }
    expect(await legacyEvent('order_created', 'legacy_order', { status: 'paid', first_order_item: { variant_id: '2' } })).toBe(200);
    expect(await legacyEvent('order_refunded', 'legacy_order', {})).toBe(200);
    expect(await legacyEvent('subscription_payment_success', 'invoice', { subscription_id: 'legacy-sub' })).toBe(200);
    expect(await legacyEvent('subscription_cancelled', 'legacy-sub', {})).toBe(200);
    const account = await balance(await f.context('/api/account/balance', {}, 'owner'));
    expect(await account.json()).toMatchObject({
      balance: 880, subscriptionStatus: 'active', subscriptionProvider: 'paddle', monthlyCheckoutBlocked: true,
    });
    const legacyRows = await f.db.prepare('SELECT ls_order_id FROM credit_events WHERE ls_order_id IS NOT NULL ORDER BY rowid').all();
    expect(legacyRows.results).toEqual([
      { ls_order_id: 'legacy_order' }, { ls_order_id: 'legacy_order:refund' }, { ls_order_id: 'sub_legacy-sub:inv_invoice' },
    ]);
  });
});
