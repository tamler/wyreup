import { bytesToHex, hmacSha256Hex, timingSafeEqualHex } from '../../_lib/crypto';
import type { D1Database, D1PreparedStatement, Env } from '../../_lib/env';
import {
  PACKS, PayloadTooLarge, billingConfig, boundedBody, decodeJson, isPack, matchesPrice, object, paddleId,
} from '../../_lib/paddle';
import type { PaddleConfig, Pack } from '../../_lib/paddle';
import { adjustmentWrites, settlementWrites, subscriptionUpdate } from '../../_lib/paddle-ledger';
import type { PagesFunction } from '../../_lib/types';

const SUBSCRIPTION_EVENTS = new Set([
  'subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.canceled',
  'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.trialing',
]);
const SUBSCRIPTION_PRIORITY = new Map([
  ['trialing', 1], ['active', 2], ['past_due', 3], ['paused', 4], ['canceled', 5],
]);
const ADJUSTMENT_ACTIONS = new Set(['refund', 'credit', 'credit_reverse', 'chargeback', 'chargeback_reverse']);
const ADJUSTMENT_PRIORITY = new Map([
  ['pending_approval', 1], ['approved', 2], ['rejected', 3], ['reversed', 4],
]);

class InvalidEvent extends Error {
  constructor(readonly status: number) { super('Paddle event could not be processed'); }
}

function eventTime(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidEvent(400);
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) throw new InvalidEvent(400);
  const seconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(seconds) || new Date(seconds).toISOString().slice(0, 19) !== match[1]) {
    throw new InvalidEvent(400);
  }
  return `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}Z`;
}

function money(value: unknown, signed = false): number {
  if (typeof value !== 'string' || !/^-?\d{1,10}$/.test(value)) throw new InvalidEvent(400);
  const amount = Number(value);
  if ((!signed && amount < 0) || Math.abs(amount) > 1_000_000_000) throw new InvalidEvent(400);
  return amount;
}

async function validSignature(header: string, body: Uint8Array, secret: string): Promise<boolean> {
  if (header.length > 512) return false;
  let timestamp = '';
  const signatures: string[] = [];
  for (const field of header.split(';')) {
    const part = field.trim();
    if (/^ts=\d{10}$/.test(part) && !timestamp) timestamp = part.slice(3);
    else if (/^h1=[a-fA-F0-9]{64}$/.test(part)) signatures.push(part.slice(3).toLowerCase());
    else return false;
  }
  if (!timestamp || !signatures.length || Math.abs(Date.now() - Number(timestamp) * 1000) > 5000) return false;
  const prefix = new TextEncoder().encode(`${timestamp}:`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const computed = await hmacSha256Hex(secret, signed);
  let matched = 0;
  for (const signature of signatures) matched |= Number(timingSafeEqualHex(signature, computed));
  return matched === 1;
}

interface Checkout {
  user_id: string;
  customer_id: string | null;
  pack: Pack;
  price_id: string;
  credits: number;
  unit_amount: number;
  currency: string;
  quantity: number;
  state: string;
}

function checkoutById(db: D1Database, mode: string, transactionId: string): Promise<Checkout | null> {
  return db.prepare(`
    SELECT user_id,customer_id,pack,price_id,credits,unit_amount,currency,quantity,state
    FROM paddle_checkouts WHERE mode=? AND transaction_id=?
  `).bind(mode, transactionId).first<Checkout>();
}

async function completed(
  db: D1Database, config: PaddleConfig, data: Record<string, unknown>,
): Promise<D1PreparedStatement[]> {
  const { id, origin, status, subscription_id: subscriptionId, customer_id: customerId } = data;
  if (!paddleId(id, 'txn') || status !== 'completed' || typeof origin !== 'string') {
    throw new InvalidEvent(400);
  }
  if (origin !== 'api' && origin !== 'subscription_recurring') return [];
  if (!paddleId(customerId, 'ctm')) {
    throw new InvalidEvent(400);
  }
  const initial = origin === 'api';
  const checkout = initial ? await checkoutById(db, config.mode, id) : null;
  const items = data.items;
  if (!Array.isArray(items)) throw new InvalidEvent(400);
  const configured = [...config.prices.entries()].find(([, priceId]) =>
    items.some(item => object(object(item).price).id === priceId),
  );
  if (!configured && !checkout) return [];
  if (initial && !checkout) throw new InvalidEvent(503);
  if (checkout && (checkout.customer_id !== customerId || !['open', 'fulfilled'].includes(checkout.state))) {
    throw new InvalidEvent(409);
  }
  const pack = checkout?.pack ?? 'monthly';
  if (!isPack(pack)) throw new InvalidEvent(409);
  const priceId = config.prices.get(pack);
  const product = PACKS[pack];
  if (!priceId || !configured || configured[0] !== pack || (checkout && (
    checkout.price_id !== priceId || checkout.credits !== product.credits || checkout.unit_amount !== product.cents
    || checkout.currency !== 'USD' || checkout.quantity !== 1
  ))) throw new InvalidEvent(409);

  const item = object(items[0]);
  const details = object(data.details);
  const total = object(details.totals);
  const lines = details.line_items;
  const line = Array.isArray(lines) ? object(lines[0]) : {};
  const lineTotals = object(line.totals);
  const subtotal = money(lineTotals.subtotal);
  const grandTotal = money(total.grand_total);
  if (data.collection_mode !== 'automatic' || data.currency_code !== 'USD'
    || items.length !== 1 || item.quantity !== 1 || item.proration !== null
    || !matchesPrice(object(item.price), pack, priceId)
    || !Array.isArray(lines) || lines.length !== 1 || !paddleId(line.id, 'txnitm')
    || line.price_id !== priceId || line.quantity !== 1 || line.proration !== null
    || !subtotal || subtotal > product.cents || grandTotal < product.cents
    || money(total.subtotal) !== subtotal || money(lineTotals.total) !== grandTotal
    || money(lineTotals.discount) !== 0 || money(total.discount) !== 0
    || money(total.credit) !== 0 || money(total.balance) !== 0) throw new InvalidEvent(409);

  const monthly = pack === 'monthly';
  if (monthly ? !paddleId(subscriptionId, 'sub') : subscriptionId !== null) throw new InvalidEvent(409);
  const subId = monthly ? subscriptionId as string : null;
  const writes: D1PreparedStatement[] = [];
  let userId: string;
  if (checkout) {
    userId = checkout.user_id;
    if (subId) writes.push(subscriptionUpdate(db, config.mode, {
      id: subId, customerId, priceId, status: 'active', time: '', priority: 0,
      initialTransactionId: id, userId,
    }));
  } else {
    const subscription = await db.prepare(`
      SELECT user_id,customer_id,price_id FROM paddle_subscriptions WHERE mode=? AND subscription_id=?
    `).bind(config.mode, subId).first<{ user_id: string | null; customer_id: string; price_id: string }>();
    if (!subscription?.user_id) throw new InvalidEvent(503);
    if (subscription.customer_id !== customerId || subscription.price_id !== priceId) throw new InvalidEvent(409);
    userId = subscription.user_id;
  }
  writes.push(...settlementWrites(db, config.mode, {
    transactionId: id, priceId, itemId: line.id, userId, customerId, subscriptionId: subId,
    subtotal, credits: product.credits, initial,
  }));
  return writes;
}

async function subscription(
  db: D1Database, config: PaddleConfig, type: string, data: Record<string, unknown>,
): Promise<D1PreparedStatement[]> {
  const { id, customer_id: customerId, status } = data;
  if (!paddleId(id, 'sub') || !paddleId(customerId, 'ctm') || !Array.isArray(data.items) || typeof status !== 'string') {
    throw new InvalidEvent(400);
  }
  const priority = SUBSCRIPTION_PRIORITY.get(status);
  if (!priority) throw new InvalidEvent(400);
  const priceId = config.prices.get('monthly');
  if (!priceId || !data.items.some(item => object(object(item).price).id === priceId)) return [];
  const item = object(data.items[0]);
  if (data.items.length !== 1 || item.quantity !== 1 || data.collection_mode !== 'automatic'
    || data.currency_code !== 'USD' || !matchesPrice(object(item.price), 'monthly', priceId)) {
    throw new InvalidEvent(409);
  }
  let initialTransactionId: string | null = null;
  let userId: string | null = null;
  if (type === 'subscription.created') {
    if (!paddleId(data.transaction_id, 'txn')) throw new InvalidEvent(400);
    const checkout = await checkoutById(db, config.mode, data.transaction_id);
    if (!checkout) throw new InvalidEvent(503);
    if (checkout.pack !== 'monthly' || checkout.price_id !== priceId || checkout.customer_id !== customerId
      || !['open', 'fulfilled'].includes(checkout.state)) throw new InvalidEvent(409);
    initialTransactionId = data.transaction_id;
    userId = checkout.user_id;
  }
  return [subscriptionUpdate(db, config.mode, {
    id, customerId, priceId, priority, userId, initialTransactionId,
    status: status === 'canceled' ? 'cancelled' : status,
    time: eventTime(data.updated_at),
  })];
}

function adjustment(
  db: D1Database, config: PaddleConfig, data: Record<string, unknown>,
): D1PreparedStatement[] {
  const { id, transaction_id: transactionId, customer_id: customerId, action, status } = data;
  if (typeof action !== 'string' || typeof status !== 'string') throw new InvalidEvent(400);
  if (!ADJUSTMENT_ACTIONS.has(action)) return [];
  if (typeof data.currency_code === 'string' && /^[A-Z]{3}$/.test(data.currency_code) && data.currency_code !== 'USD') return [];
  const priority = ADJUSTMENT_PRIORITY.get(status);
  if (!priority || !paddleId(id, 'adj') || !paddleId(transactionId, 'txn') || !paddleId(customerId, 'ctm')
    || data.currency_code !== 'USD' || !Array.isArray(data.items)) throw new InvalidEvent(400);
  // Each Wyreup payment has exactly one item. Multi-item adjustments cannot affect it.
  if (data.items.length > 1) return [];
  const reversing = action === 'chargeback_reverse' || action === 'credit_reverse';
  const subtotal = money(object(data.totals).subtotal, reversing);
  const item = object(data.items[0]);
  let itemId: string | null = null;
  if (data.items.length === 1) {
    if (!paddleId(item.item_id, 'txnitm') || money(object(item.totals).subtotal, reversing) !== subtotal) {
      throw new InvalidEvent(400);
    }
    itemId = item.item_id;
  } else if (data.type !== 'full') {
    throw new InvalidEvent(400);
  }
  return adjustmentWrites(db, config.mode, {
    id, transactionId, customerId, itemId, action, status, priority,
    subtotal: Math.abs(subtotal), time: eventTime(data.updated_at),
  });
}

async function eventWrites(
  db: D1Database, config: PaddleConfig, type: string, data: Record<string, unknown>,
): Promise<D1PreparedStatement[]> {
  if (type === 'transaction.completed') return completed(db, config, data);
  if (type === 'adjustment.created' || type === 'adjustment.updated') return adjustment(db, config, data);
  if (SUBSCRIPTION_EVENTS.has(type)) return subscription(db, config, type, data);
  if (type === 'transaction.canceled') {
    if (!paddleId(data.id, 'txn') || data.status !== 'canceled') throw new InvalidEvent(400);
    return [db.prepare(`
      UPDATE paddle_checkouts SET state='cancelled'
      WHERE mode=? AND transaction_id=? AND state IN ('open','blocked')
    `).bind(config.mode, data.id)];
  }
  return [];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const header = request.headers.get('Paddle-Signature');
  if (!header) return new Response('Unauthorized', { status: 401 });
  try {
    const config = await billingConfig(env, request);
    if (!config) return new Response('Billing unavailable', { status: 503 });
    const bytes = await boundedBody(request);
    if (!await validSignature(header, bytes, config.webhookSecret)) {
      return new Response('Unauthorized', { status: 401 });
    }
    const event = object(decodeJson(bytes));
    const { event_id: id, event_type: type } = event;
    const data = object(event.data);
    if (!paddleId(id, 'evt') || typeof type !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(type)
      || !Object.keys(data).length) throw new InvalidEvent(400);
    eventTime(event.occurred_at);
    const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    const seen = await env.DB.prepare('SELECT digest FROM paddle_events WHERE mode=? AND event_id=?')
      .bind(config.mode, id).first<{ digest: string }>();
    if (seen) return new Response(seen.digest === digest ? 'OK' : 'Conflicting event', {
      status: seen.digest === digest ? 200 : 409,
    });
    const writes = await eventWrites(env.DB, config, type, data);
    const result = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO paddle_events (mode,event_id,digest) VALUES (?,?,?)
        ON CONFLICT(mode,event_id) DO UPDATE SET digest=CASE WHEN digest=excluded.digest THEN digest END
      `).bind(config.mode, id, digest),
      ...writes,
    ]);
    if (result.some(statement => !statement.success)) return new Response('Event could not be processed', { status: 503 });
    return new Response('OK');
  } catch (error) {
    if (error instanceof PayloadTooLarge) return new Response('Payload too large', { status: 413 });
    const status = error instanceof InvalidEvent ? error.status
      : error instanceof SyntaxError || error instanceof TypeError ? 400 : 503;
    return new Response('Event could not be processed', { status });
  }
};
