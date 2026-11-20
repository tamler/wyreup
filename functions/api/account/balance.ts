// GET /api/account/balance
// Used by the browser during checkout polling and on page load to hydrate
// $user from the session cookie. Returns 401 if not authenticated.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { getBalance, json, resolveUser, unauthorized } from '../../_lib/auth';
import { billingAccount } from '../../_lib/billing-account';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const [balance, billing] = await Promise.all([
    getBalance(user.id, env),
    billingAccount(user.id, env),
  ]);
  return json({
    email: user.email,
    balance,
    ...billing,
  });
};
