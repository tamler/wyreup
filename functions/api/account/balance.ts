// GET /api/account/balance
// Used by the browser during checkout polling and on page load to hydrate
// $user from the session cookie. Returns 401 if not authenticated.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { getBalance, json, resolveUser, unauthorized } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const [balance, subRow] = await Promise.all([
    getBalance(user.id, env),
    env.DB.prepare(`SELECT subscription_status FROM users WHERE id = ?`)
      .bind(user.id)
      .first<{ subscription_status: string | null }>(),
  ]);
  return json({
    email: user.email,
    balance,
    subscriptionStatus: subRow?.subscription_status ?? null,
  });
};
