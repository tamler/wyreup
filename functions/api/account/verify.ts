// POST /api/account/verify
// Body: optional — auth is via Authorization: Bearer wk_live_...
// Sets a signed __Host-wyreup_session cookie, returns { email, balance }.
// See docs/pro-auth-spec.md §5 + §7.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { getBalance, json, resolveUser, unauthorized } from '../../_lib/auth';
import { signSessionCookie } from '../../_lib/crypto';

const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const cookie = await signSessionCookie(
    { uid: user.id, kid: user.kid, exp },
    env.SESSION_SECRET,
  );

  const [balance, subRow] = await Promise.all([
    getBalance(user.id, env),
    env.DB.prepare(
      `SELECT subscription_status FROM users WHERE id = ?`,
    )
      .bind(user.id)
      .first<{ subscription_status: string | null }>(),
  ]);

  return json(
    {
      email: user.email,
      balance,
      subscriptionStatus: subRow?.subscription_status ?? null,
    },
    200,
    {
      'Set-Cookie': [
        `__Host-wyreup_session=${cookie}`,
        `Path=/`,
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        `HttpOnly`,
        `Secure`,
        `SameSite=Lax`,
      ].join('; '),
    },
  );
};
