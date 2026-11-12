import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onRequest } from './ref';
import { createSqliteTestDb } from '../../_lib/test/sqlite';
import type { Env } from '../../_lib/env';
import type { PagesFunctionContext } from '../../_lib/types';

let db: Awaited<ReturnType<typeof createSqliteTestDb>>;
let env: Env;
function context(body: string, origin = 'https://wyreup.com'): PagesFunctionContext {
  return { request: new Request('https://wyreup.com/api/metrics/ref', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
  }), env, params: {}, data: {}, next: () => Promise.resolve(new Response()), waitUntil: () => {} };
}
beforeEach(async () => { db = await createSqliteTestDb(); env = { DB: db.db, METRICS_REF_TAGS: 'youtube,rumble' } as Env; });
afterEach(async () => { await db.close(); });

describe('anonymous campaign counter', () => {
  it('records approved tags without any visitor identifier', async () => {
    const res = await onRequest(context('{"ref":"youtube"}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });
    const rows = await env.DB.prepare('SELECT kind, label, n FROM attribution_daily').all();
    expect(rows.results).toEqual([{ kind: 'visit', label: 'youtube', n: 1 }]);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('rejects cross-origin requests, free text, extra fields and oversized bodies without storing them', async () => {
    // A deployment setting cannot expand the public source-controlled list.
    env.METRICS_REF_TAGS = 'youtube,private-id-123';
    for (const ctx of [context('{"ref":"youtube"}', 'https://evil.example'), context('{"ref":"private-id-123"}'), context('{"ref":"youtube","email":"person@example.com"}'), context(JSON.stringify({ ref: 'x'.repeat(1000) }))]) {
      const res = await onRequest(ctx);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM attribution_daily').first<{ n: number }>())?.n).toBe(0);
  });
});
