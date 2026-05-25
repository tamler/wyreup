// POST /api/account/signout — clears the __Host-wyreup_session cookie.
// The underlying API key remains valid; this only ends the browser session.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  return json(
    { ok: true },
    200,
    {
      'Set-Cookie': [
        `__Host-wyreup_session=`,
        `Path=/`,
        `Max-Age=0`,
        `HttpOnly`,
        `Secure`,
        `SameSite=Lax`,
      ].join('; '),
    },
  );
};
