// POST /api/account/signout — clears the wyreup_session cookie.
// The underlying API key remains valid; this only ends the browser session.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json } from '../../_lib/auth';

export const onRequestPost: PagesFunction<Env> = () => {
  return json(
    { ok: true },
    200,
    {
      'Set-Cookie': [
        `wyreup_session=`,
        `Path=/`,
        `Max-Age=0`,
        `HttpOnly`,
        `Secure`,
        `SameSite=Lax`,
      ].join('; '),
    },
  );
};
