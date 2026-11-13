import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './metrics';
import { createSqliteTestDb } from '../../_lib/test/sqlite';
import type { Env } from '../../_lib/env';
import type { PagesFunctionContext } from '../../_lib/types';
import { requireAdmin } from '../../_lib/auth';

const key = 'a'.repeat(64);
let db: Awaited<ReturnType<typeof createSqliteTestDb>>;
let env: Env;
function context(url = 'https://wyreup.com/api/ops/metrics?since=24h', authorization = `Bearer ${key}`, method = 'GET'): PagesFunctionContext {
  return { request: new Request(url, { method, headers: { authorization } }), env, params: {}, data: {}, next: () => Promise.resolve(new Response()), waitUntil: () => {} };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
  db = await createSqliteTestDb();
  env = { DB: db.db, OPS_METRICS_KEY: key, METRICS_REF_TAGS: 'youtube,rumble' } as Env;
});
afterEach(async () => { await db.close(); vi.useRealTimers(); });

describe('read-only ops metrics', () => {
  it('rejects missing, malformed and unrelated credentials without cacheable errors', async () => {
    for (const credential of ['', `Bearer ${'b'.repeat(64)}`, 'Bearer wk_live_test']) {
      const res = await onRequest(context(undefined, credential));
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
    const noKey = { ...env, OPS_METRICS_KEY: '' };
    expect((await onRequest({ ...context(), env: noKey })).status).toBe(401);
    expect(await requireAdmin(context().request, env)).toBeInstanceOf(Response);
  });
  it('rejects other methods and duplicate or extra parameters with no-store', async () => {
    for (const ctx of [context(undefined, `Bearer ${key}`, 'POST'), context('https://wyreup.com/api/ops/metrics?since=7d&since=24h'), context('https://wyreup.com/api/ops/metrics?since=7d&x=1')]) {
      const res = await onRequest(ctx);
      expect([400, 405]).toContain(res.status);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });
  it('returns bounded aggregates, hides private data and reports missing metrics', async () => {
    const end = Date.now();
    await db.exec(`INSERT INTO users(id,email,created_at,signup_ref,subscription_status) VALUES
      ('u1','private@example.com',${end - 1000},'youtube','active'),
      ('u2','private2@example.com',${end - 90000000},'secret-unique','cancelled');
      INSERT INTO run_history(id,user_id,tool_id,tier,ran_at,file_name) VALUES
      ('r1','u1','text-summarize-pro','pro',${end - 1000},'private.txt'),
      ('r2','u2','unknown-private-tool','pro',${end - 2000},'private.txt');
      INSERT INTO credit_events(id,user_id,kind,amount,created_at,ls_order_id) VALUES
      ('p1','u1','purchase',220,${end - 5000},'private-order'),
      ('s1','u1','spend',-4,${end - 4000},NULL),
      ('p2','u2','subscription_grant',440,${end - 3000},'private-invoice');
      INSERT INTO attribution_daily(day,kind,label,n) VALUES ('2026-11-13','visit','youtube',3), ('2026-11-13','visit','secret-unique',2);`);
    const res = await onRequest(context());
    expect(res.status).toBe(200);
    const body = await res.json() as {
      product: string;
      metrics: {
        signups: { total: number };
        activeUsers: { dau: number; wau: number };
        credits: { bought: number; spent: number };
        purchases: { creditOrders: number; subscriptionInvoices: number };
        runs: { byTool: Record<string, number> };
        revenue: null;
        attribution: { purchaseRefs: Array<{ ref: string; n: number }> };
      };
    };
    expect(body.product).toBe('wyreup');
    expect(body.metrics.signups.total).toBe(1);
    expect(body.metrics.activeUsers).toEqual({ dau: 2, wau: 2 });
    expect(body.metrics.credits).toMatchObject({ bought: 220, spent: 4 });
    expect(body.metrics.purchases).toEqual({ creditOrders: 1, subscriptionInvoices: 1 });
    expect(body.metrics.runs.byTool).toEqual({ 'text-summarize-pro': 1, other: 1 });
    expect(body.metrics.revenue).toBeNull();
    const serialized = JSON.stringify(body);
    for (const forbidden of ['private@example.com', 'private.txt', 'private-order', 'secret-unique', 'unknown-private-tool']) expect(serialized).not.toContain(forbidden);
    expect(body.metrics.attribution.purchaseRefs).toEqual(expect.arrayContaining([expect.objectContaining({ ref: 'youtube', n: 1 }), expect.objectContaining({ ref: 'unknown', n: 1 })]));
  });
  it('fails closed if schema or query is unavailable', async () => {
    await db.exec('DROP TABLE attribution_daily;');
    const res = await onRequest(context());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Metrics unavailable' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
