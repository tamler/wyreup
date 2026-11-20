import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import {
  BILLABLE, LEGACY_MONTHLY_CLEAR, PACKS, billingConfig, boundedBody, decodeJson, isPack, matchesPrice, object, paddleFetch, paddleId,
} from '../../_lib/paddle';
import type { PaddleConfig } from '../../_lib/paddle';
import type { PagesFunction } from '../../_lib/types';

function paymentLink(config: PaddleConfig, transactionId: string): Response {
  const checkoutUrl = new URL('/checkout', config.origin);
  checkoutUrl.searchParams.set('_ptxn', transactionId);
  return json({ checkoutUrl: checkoutUrl.href, transactionId });
}

async function verifiedCustomer(
  env: Env, config: PaddleConfig, userId: string, email: string,
): Promise<string> {
  const customer = await env.DB.prepare(
    'SELECT customer_id FROM paddle_customers WHERE mode=? AND user_id=?',
  ).bind(config.mode, userId).first<{ customer_id: string }>();
  if (customer) return customer.customer_id;

  const lookup = async () => {
    const path = `/customers?${new URLSearchParams({ email, per_page: '2' })}`;
    const result = await paddleFetch(config, path, 'GET');
    if (!result.ok || !Array.isArray(result.payload.data) || result.payload.data.length > 1) {
      throw new Error('Paddle customer lookup failed');
    }
    return object(result.payload.data[0]);
  };

  let data = await lookup();
  if (!data.id) {
    const result = await paddleFetch(config, '/customers', 'POST', { email });
    if (result.ok) data = object(result.payload.data);
    else if (result.status === 409 && object(result.payload.error).code === 'customer_already_exists') {
      data = await lookup();
    }
  }
  if (!paddleId(data.id, 'ctm') || data.status !== 'active' || data.email !== email) {
    throw new Error('Paddle customer ownership could not be verified');
  }
  await env.DB.prepare(
    'INSERT INTO paddle_customers (mode,user_id,customer_id) VALUES (?,?,?) ON CONFLICT(mode,user_id) DO NOTHING',
  ).bind(config.mode, userId, data.id).run();
  const bound = await env.DB.prepare(
    'SELECT customer_id FROM paddle_customers WHERE mode=? AND user_id=?',
  ).bind(config.mode, userId).first<{ customer_id: string }>();
  if (bound?.customer_id !== data.id) throw new Error('Paddle customer binding disagrees');
  return data.id;
}

async function setUnavailable(
  env: Env, config: PaddleConfig, intent: string, state: 'blocked' | 'cancelled', transactionId?: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE paddle_checkouts SET state=?, transaction_id=?
    WHERE mode=? AND intent_id=? AND state='creating'
  `).bind(state, transactionId ?? null, config.mode, intent).run();
}

async function recoverTransactionBinding(
  env: Env, config: PaddleConfig, intent: string, transactionId: string,
): Promise<Response> {
  // UPDATE may have committed without an acknowledgement. A concurrent request
  // could already have resumed an open transaction, so check before cancellation.
  const current = await env.DB.prepare(`
    SELECT state, intent_id FROM paddle_checkouts WHERE mode=? AND transaction_id=?
  `).bind(config.mode, transactionId).first<{ state: string; intent_id: string }>();
  if (current?.intent_id === intent && (current.state === 'open' || current.state === 'fulfilled')) {
    return paymentLink(config, transactionId);
  }
  if (current) return json({ error: 'Checkout needs reconciliation. Contact support before retrying.' }, 503);

  let cancelled = false;
  try {
    const result = await paddleFetch(config, `/transactions/${transactionId}`, 'PATCH', { status: 'canceled' });
    const data = object(result.payload.data);
    cancelled = result.ok && data.id === transactionId && data.status === 'canceled';
  } catch {
    // Keep this reservation while the provider outcome is uncertain.
  }
  await setUnavailable(env, config, intent, cancelled ? 'cancelled' : 'blocked', transactionId);
  return json({
    error: cancelled ? 'Could not start checkout. Try again.' : 'Checkout needs reconciliation. Contact support before retrying.',
  }, 503);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const csrfError = requireCsrfHeader(request, user);
  if (csrfError) return csrfError;

  const { pack } = object(await boundedBody(request).then(decodeJson).catch(() => null));
  if (!isPack(pack)) return json({ error: 'Unknown pack' }, 400);

  const config = await billingConfig(env, request);
  if (!config) return json({ error: 'Payments are temporarily unavailable.' }, 503);
  const priceId = config.prices.get(pack);
  if (!priceId) return json({ error: 'Payments are temporarily unavailable.' }, 503);
  const intent = crypto.randomUUID();
  const product = PACKS[pack];

  const monthlyAvailable = `(
    ${LEGACY_MONTHLY_CLEAR}
    AND NOT EXISTS (SELECT 1 FROM paddle_subscriptions
      WHERE mode=? AND user_id=users.id AND status IN ${BILLABLE})
  )`;
  const inserted = await env.DB.prepare(`
    INSERT INTO paddle_checkouts
      (mode,intent_id,user_id,pack,price_id,credits,unit_amount,currency,quantity,state,created_at)
    SELECT ?, ?, id, ?, ?, ?, ?, 'USD', 1, 'creating', ? FROM users
    WHERE id=? AND (? != 'monthly' OR ${monthlyAvailable})
    ON CONFLICT DO NOTHING
  `).bind(
    config.mode, intent, pack, priceId, product.credits, product.cents, Date.now(), user.id, pack, config.mode,
  ).run();
  if (!inserted.meta.changes) {
    const pending = await env.DB.prepare(`
      SELECT state, transaction_id, price_id FROM paddle_checkouts c JOIN users ON users.id=c.user_id
      WHERE c.mode=? AND c.user_id=? AND c.pack=? AND state IN ('creating','open','blocked')
        AND (c.pack != 'monthly' OR ${monthlyAvailable})
    `).bind(config.mode, user.id, pack, config.mode)
      .first<{ state: string; transaction_id: string | null; price_id: string }>();
    if (pending?.state === 'open' && pending.price_id === priceId && pending.transaction_id) {
      return paymentLink(config, pending.transaction_id);
    }
    if (pending?.state === 'creating') return json({ error: 'Checkout is being prepared. Try again shortly.' }, 409);
    if (pending) return json({ error: 'An earlier checkout needs reconciliation. Contact support.' }, 409);
    return json({ error: 'You already have a monthly subscription.' }, 409);
  }

  let customerId: string;
  try {
    const price = await paddleFetch(config, `/prices/${priceId}`, 'GET');
    const catalog = object(price.payload.data);
    const quantity = object(catalog.quantity);
    if (!price.ok || !matchesPrice(catalog, pack, priceId) || catalog.status !== 'active'
      || quantity.minimum !== 1 || quantity.maximum !== 1
      || !Array.isArray(catalog.unit_price_overrides) || catalog.unit_price_overrides.length !== 0) {
      await setUnavailable(env, config, intent, 'cancelled');
      return json({ error: 'This pack is temporarily unavailable.' }, 503);
    }
    customerId = await verifiedCustomer(env, config, user.id, user.email);
    await env.DB.prepare(`
      UPDATE paddle_checkouts SET customer_id=? WHERE mode=? AND intent_id=? AND state='creating'
    `).bind(customerId, config.mode, intent).run();
  } catch {
    // Customer uncertainty is reconciled with an exact-email lookup on retry.
    // No payable transaction has been attempted at this point.
    await setUnavailable(env, config, intent, 'cancelled');
    return json({ error: 'Could not prepare checkout. Try again.' }, 503);
  }

  let transactionId: string;
  try {
    const result = await paddleFetch(config, '/transactions', 'POST', {
      items: [{ price_id: priceId, quantity: 1 }],
      customer_id: customerId,
      collection_mode: 'automatic',
      currency_code: 'USD',
      checkout: { url: `${config.origin}/checkout` },
      custom_data: { wyreup_intent: intent },
    });
    const data = object(result.payload.data);
    if (!result.ok || !paddleId(data.id, 'txn')) {
      const definitelyRejected = [400, 401, 403, 404, 422].includes(result.status)
        && object(result.payload.error).type === 'request_error';
      await setUnavailable(env, config, intent, definitelyRejected ? 'cancelled' : 'blocked');
      return json({
        error: definitelyRejected ? 'Could not start checkout.' : 'Checkout needs reconciliation. Contact support before retrying.',
      }, 503);
    }
    transactionId = data.id;
    if ((data.status !== 'draft' && data.status !== 'ready') || data.customer_id !== customerId) {
      return await recoverTransactionBinding(env, config, intent, transactionId);
    }
  } catch {
    await setUnavailable(env, config, intent, 'blocked');
    return json({ error: 'Checkout needs reconciliation. Contact support before retrying.' }, 503);
  }

  try {
    const bound = await env.DB.prepare(`
      UPDATE paddle_checkouts SET transaction_id=?, state='open'
      WHERE mode=? AND intent_id=? AND state='creating'
    `).bind(transactionId, config.mode, intent).run();
    if (bound.meta.changes === 1) return paymentLink(config, transactionId);
  } catch {
    // Check committed state before deciding whether cancellation is safe.
  }
  try {
    return await recoverTransactionBinding(env, config, intent, transactionId);
  } catch {
    return json({ error: 'Checkout needs reconciliation. Contact support before retrying.' }, 503);
  }
};
