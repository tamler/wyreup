import { json, resolveUser, unauthorized } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import { billingConfig, paddleId } from '../../_lib/paddle';
import type { PagesFunction } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get('transactionId');
  if (!paddleId(id, 'txn')) return json({ error: 'Invalid transaction' }, 400);
  const config = await billingConfig(env, request);
  if (!config) return json({ error: 'Payments are temporarily unavailable.' }, 503);
  const checkout = await env.DB.prepare(`
    SELECT state FROM paddle_checkouts WHERE mode=? AND transaction_id=? AND user_id=?
  `).bind(config.mode, id, user.id).first<{ state: string }>();
  if (!checkout) return json({ error: 'Checkout not found' }, 404);
  return json({ state: checkout.state });
};
