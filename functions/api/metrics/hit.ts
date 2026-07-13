// POST /api/metrics/hit { kind, detail? }
// Aggregate, cookieless funnel counter — no identifiers are stored, only a
// per-day count per event kind. Unauthenticated by design (it fires from the
// public site before any account exists); the kind allowlist, same-origin
// check, and detail length cap bound the damage an abuser can do to
// inflating a counter.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json } from '../../_lib/auth';
import { appOrigin } from '../../_lib/env';

const KINDS = new Set(['pro-page-view', 'pro-seam-click', 'job-seam-click']);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin');
  if (origin && origin !== appOrigin(env)) {
    return json({ error: 'Wrong origin' }, 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    detail?: string;
  };
  const kind = body.kind || '';
  if (!KINDS.has(kind)) return json({ error: 'Unknown kind' }, 400);
  const detail = (body.detail || '').slice(0, 64);

  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO page_events (day, kind, detail, n) VALUES (?, ?, ?, 1)
       ON CONFLICT(day, kind, detail) DO UPDATE SET n = n + 1`,
    )
      .bind(day, kind, detail)
      .run();
  } catch {
    // Table not migrated yet — never fail the page over a counter.
  }
  return json({ ok: true });
};
