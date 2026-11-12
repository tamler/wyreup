// POST /api/shares/delete  { id }  remove one of the caller's share links.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../_lib/auth';
import { readJsonObject, RequestBodyError } from '../../_lib/request';
import { isShareId, shareCleanupStatements, shareLinksEnabled } from '../../_lib/shares';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!shareLinksEnabled(env)) return json({ error: 'Not found' }, 404);
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 4096);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    throw error;
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!isShareId(id)) return json({ error: 'id required' }, 400);

  // Deleting a link does not return its run: share_creations keeps the record,
  // so delete-and-recreate cannot store more text than was paid for.
  const [res] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM shared_results WHERE id = ? AND user_id = ?`).bind(id, user.id),
    ...shareCleanupStatements(env.DB, Date.now()),
  ]);
  if ((res?.meta.changes ?? 0) !== 1) return json({ error: 'Link not found' }, 404);

  return json({ ok: true });
};
