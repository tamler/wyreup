import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { appOrigin } from '../../_lib/env';
import { campaignRef } from '../../_lib/attribution';
import { readJsonObject, RequestBodyError } from '../../_lib/request';

// Per-isolate backstop, not a fleet-wide limit. No network identity is stored.
let tokens = 30;
let updated = Date.now();
function admit(now: number): boolean {
  tokens = Math.min(30, tokens + Math.max(0, now - updated) / 1000);
  updated = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}
function response(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== appOrigin(env) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return response({ error: 'Wrong origin' }, 403);
  if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return response({ error: 'Invalid content type' }, 415);
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 256);
  } catch (error) {
    return response({ error: 'Invalid request' }, error instanceof RequestBodyError ? error.status : 400);
  }
  if (Object.keys(body).length !== 1 || !campaignRef(body.ref, env)) return response({ accepted: false }, 400);
  if (!admit(Date.now())) return response({ accepted: false }, 429);
  try {
    const result = await env.DB.prepare(`INSERT INTO attribution_daily (day, kind, label, n)
      VALUES (?, 'visit', ?, 1)
      ON CONFLICT(day, kind, label) DO UPDATE SET n = n + 1 WHERE n < 100000`)
      .bind(new Date().toISOString().slice(0, 10), body.ref).run();
    if (!result.success) throw new Error('counter failed');
    return response({ accepted: true });
  } catch {
    return response({ accepted: false }, 503);
  }
};
