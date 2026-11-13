import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './run';
import type { Env, D1Result } from '../../../_lib/env';
import type { PagesFunctionContext } from '../../../_lib/types';
import { PRICING } from '../../../_lib/pricing';
import { createSqliteTestDb } from '../../../_lib/test/sqlite';
import type * as Auth from '../../../_lib/auth';
import { MANAGED_DEADLINE_MS } from '../../../_lib/pro-requests';

vi.mock('../../../_lib/auth', async (original) => ({
  ...(await original<typeof Auth>()),
  resolveUser: vi.fn(() => Promise.resolve({ id: 'user' })),
  requireCsrfHeader: vi.fn(() => null),
}));

describe('Pro endpoint admission order', () => {
  let sqlite: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let env: Env;
  beforeEach(async () => {
    sqlite = await createSqliteTestDb();
    env = {
      DB: sqlite.db,
      SESSION_SECRET: 'synthetic-test-secret',
      AI: { run: vi.fn(() => Promise.resolve({ response: 'positive' })) },
    } as unknown as Env;
    await sqlite.exec(
      "INSERT INTO users(id,email,created_at) VALUES('user','user@example.com',0); INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('grant','user','grant',100,0);",
    );
  });
  afterEach(async () => {
    await sqlite.close();
    vi.restoreAllMocks();
  });
  const request = (body: unknown) =>
    onRequestPost({
      request: new Request('https://wyreup.com/api/tools/pro/run', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      env,
    } as PagesFunctionContext);

  it('every priced runner rejects missing required input without reserving or invoking a provider', async () => {
    for (const toolId of Object.keys(PRICING)) {
      expect((await request({ toolId, input: {} })).status, toolId).toBe(400);
    }
    expect(vi.spyOn(env.AI, 'run')).not.toHaveBeenCalled();
    expect(
      await sqlite.db
        .prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind != 'grant'")
        .first(),
    ).toEqual({ n: 0 });
  });
  it.each([
    null,
    [],
    { toolId: 'text-sentiment-pro', input: null },
    { toolId: 'text-sentiment-pro', input: [] },
  ])('rejects invalid body %j', async (body) => {
    expect((await request(body)).status).toBe(400);
    expect(vi.spyOn(env.AI, 'run')).not.toHaveBeenCalled();
  });
  it('a successful run settles the same reserved spend and returns output', async () => {
    const response = await request({ toolId: 'text-sentiment-pro', input: { text: 'good' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { sentiment: 'positive' } });
    expect(
      await sqlite.db
        .prepare(
          'SELECT COUNT(*) AS n FROM run_history rh JOIN credit_events ce ON ce.id=rh.spend_event_id',
        )
        .first(),
    ).toEqual({ n: 1 });
  });
  it('dispatches a repeated paid request key at most once', async () => {
    const input = { text: 'good' };
    const body = {
      toolId: 'text-sentiment-pro',
      input,
      requestKey: '8fa97a65-0c3a-4dc0-9ad3-c9cf1bd0df82',
    };
    const provider = vi.spyOn(env.AI, 'run');
    await request(body);
    await request(body);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='spend'").first(),
    ).toEqual({ n: 1 });
  });
  it('serializes simultaneous attempts and rejects a key reused for other input', async () => {
    const key = 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82';
    const provider = vi.spyOn(env.AI, 'run');
    const body = { toolId: 'text-sentiment-pro', input: { text: 'good' }, requestKey: key };
    const replies = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve(request(body))));
    expect(replies.filter(r => r.status === 200)).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    const conflict = await request({ ...body, input: { text: 'other' } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'request_key_conflict' });
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='spend'").first()).toEqual({ n: 1 });
  });
  it('fails closed without the digest secret', async () => {
    env.SESSION_SECRET = '';
    const response = await request({ toolId: 'text-sentiment-pro', input: { text: 'good' }, requestKey: 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82' });
    expect(response.status).toBe(503);
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='spend'").first()).toEqual({ n: 0 });
  });
  it('protects managed pending spends from a legacy orphan refund and refunds an unknown outcome once', async () => {
    await sqlite.exec(`INSERT INTO credit_events(id,user_id,kind,amount,tool_id,created_at) VALUES('managed','user','spend',-1,'text-sentiment-pro',0);
      INSERT INTO pro_requests(user_id,request_key,tool_id,input_digest,owner_id,spend_id,state,created_at,updated_at)
      VALUES('user','aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82','text-sentiment-pro','hash','owner','managed','dispatching',0,0);`);
    await sqlite.db.prepare("INSERT OR IGNORE INTO credit_events(id,user_id,kind,amount,refund_of,created_at) VALUES('old-refund','user','refund',1,'managed',0)").run();
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE refund_of='managed'").first()).toEqual({ n: 0 });
    const statusBody = { action: 'status', requestKey: 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82' };
    expect((await request(statusBody)).status).toBe(409);
    expect((await request(statusBody)).status).toBe(409);
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE refund_of='managed'").first()).toEqual({ n: 1 });
    expect(await sqlite.db.prepare("SELECT state FROM pro_requests WHERE spend_id='managed'").first()).toEqual({ state: 'unknown_refunded' });
  });
  it('normalizes key case and cannot dispatch the same key twice', async () => {
    const key = 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82';
    const provider = vi.spyOn(env.AI, 'run');
    const body = { toolId: 'text-sentiment-pro', input: { text: 'good' }, requestKey: key };
    expect((await request(body)).status).toBe(200);
    expect((await request({ ...body, requestKey: key.toUpperCase() })).status).toBe(409);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('recovers a stale managed request when the next call is legacy and unkeyed', async () => {
    await sqlite.exec(`INSERT INTO credit_events(id,user_id,kind,amount,tool_id,created_at) VALUES('managed','user','spend',-1,'text-sentiment-pro',0);
      INSERT INTO pro_requests(user_id,request_key,tool_id,input_digest,owner_id,spend_id,state,created_at,updated_at)
      VALUES('user','aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82','text-sentiment-pro','hash','owner','managed','dispatching',0,0);`);
    expect((await request({ toolId: 'text-sentiment-pro', input: { text: 'good' } })).status).toBe(200);
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE refund_of='managed'").first()).toEqual({ n: 1 });
  });
  it('returns output when settlement committed but its acknowledgement was lost', async () => {
    const batch = sqlite.db.batch.bind(sqlite.db);
    let interrupted = false;
    vi.spyOn(sqlite.db, 'batch').mockImplementation(async statements => {
      const result = await batch(statements);
      if (!interrupted && statements.length === 2 && result[0]?.meta.changes === 1) {
        const row = await sqlite.db.prepare("SELECT state FROM pro_requests WHERE state='completed'").first();
        if (row) { interrupted = true; throw new Error('synthetic lost acknowledgement'); }
      }
      return result;
    });
    const response = await request({ toolId: 'text-sentiment-pro', input: { text: 'good' }, requestKey: 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82' });
    expect(interrupted).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { sentiment: 'positive' } });
  });
  it('does not dispatch when admission commits but its acknowledgement is lost', async () => {
    const batch = sqlite.db.batch.bind(sqlite.db);
    let lost = false;
    vi.spyOn(sqlite.db, 'batch').mockImplementation(async statements => {
      const result = await batch(statements);
      if (!lost && statements.length === 3) { lost = true; throw new Error('synthetic lost acknowledgement'); }
      return result;
    });
    const provider = vi.spyOn(env.AI, 'run');
    const response = await request({ toolId: 'text-sentiment-pro', input: { text: 'good' }, requestKey: 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82' });
    expect(lost).toBe(true);
    expect(response.status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    expect(await sqlite.db.prepare("SELECT state FROM pro_requests").first()).toEqual({ state: 'reserved' });
  });
  it('refunds a managed provider failure once and logs no provider payload', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(env.AI, 'run').mockRejectedValue(new Error('SENSITIVE_PROVIDER_PAYLOAD'));
    const key = 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82';
    const body = { toolId: 'text-sentiment-pro', input: { text: 'PRIVATE_INPUT' }, requestKey: key };
    expect((await request(body)).status).toBe(502);
    expect((await request(body)).status).toBe(409);
    expect(await sqlite.db.prepare("SELECT state FROM pro_requests WHERE request_key=?").bind(key).first()).toEqual({ state: 'failed_refunded' });
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='refund'").first()).toEqual({ n: 1 });
    expect(await sqlite.db.prepare('SELECT SUM(amount) AS balance FROM credit_events').first()).toEqual({ balance: 100 });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SENSITIVE_PROVIDER_PAYLOAD|PRIVATE_INPUT/);
    expect(JSON.stringify(log.mock.calls)).toContain('provider_failure');
  });
  it('refunds a timed out managed run and ignores a late provider success', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveProvider!: (value: unknown) => void;
    let markCalled!: () => void;
    const called = new Promise<void>(resolve => { markCalled = resolve; });
    vi.spyOn(env.AI, 'run').mockImplementation(() => {
      markCalled();
      return new Promise(resolve => { resolveProvider = resolve; });
    });
    try {
      const key = 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82';
      const pending = Promise.resolve(request({ toolId: 'text-sentiment-pro', input: { text: 'good' }, requestKey: key }));
      await called;
      await vi.advanceTimersByTimeAsync(MANAGED_DEADLINE_MS);
      const response = await pending;
      expect(response.status).toBe(502);
      resolveProvider({ response: 'positive' });
      await Promise.resolve();
      expect(await sqlite.db.prepare("SELECT state FROM pro_requests WHERE request_key=?").bind(key).first()).toEqual({ state: 'failed_refunded' });
      expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='refund'").first()).toEqual({ n: 1 });
      expect(await sqlite.db.prepare('SELECT COUNT(*) AS n FROM run_history').first()).toEqual({ n: 0 });
      expect(JSON.stringify(log.mock.calls)).toContain('timeout');
    } finally { vi.useRealTimers(); }
  });
  it('five provider failures refund once each and prevent further dispatch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(env.AI, 'run').mockRejectedValue(new Error('provider failure'));
    for (let i = 0; i < 5; i++)
      expect(
        (await request({ toolId: 'text-sentiment-pro', input: { text: 'good' } })).status,
      ).toBe(502);
    expect((await request({ toolId: 'text-sentiment-pro', input: { text: 'good' } })).status).toBe(
      429,
    );
    expect(vi.spyOn(env.AI, 'run')).toHaveBeenCalledTimes(5);
    expect(
      await sqlite.db
        .prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='refund'")
        .first(),
    ).toEqual({ n: 5 });
    expect(
      await sqlite.db.prepare('SELECT SUM(amount) AS balance FROM credit_events').first(),
    ).toEqual({ balance: 100 });
  });
  it('does not refund an orphan candidate that settles successfully before the refund insert', async () => {
    const createdAt = Date.now() - 10 * 60_000;
    await sqlite.db
      .prepare(
        "INSERT INTO credit_events(id,user_id,kind,amount,tool_id,created_at) VALUES('old_spend','user','spend',-3,'bg-remove-pro',?)",
      )
      .bind(createdAt)
      .run();
    const originalPrepare = sqlite.db.prepare.bind(sqlite.db);
    let settledBetweenStatements = false;
    vi.spyOn(sqlite.db, 'prepare').mockImplementation((sql) => {
      const statement = originalPrepare(sql);
      if (!sql.includes('SELECT spend.id AS spend_id')) return statement;
      const originalBind = statement.bind.bind(statement);
      vi.spyOn(statement, 'bind').mockImplementation((...values) => {
        const bound = originalBind(...values);
        const originalAll = bound.all.bind(bound);
        bound.all = async <T>(): Promise<D1Result<T>> => {
          const result = await originalAll<T>();
          await originalPrepare(
            "INSERT INTO run_history(id,user_id,tool_id,tier,credits_used,ran_at,spend_event_id) VALUES('late_success','user','bg-remove-pro','pro',3,?,'old_spend')",
          )
            .bind(Date.now())
            .run();
          settledBetweenStatements = true;
          return result;
        };
        return bound;
      });
      return statement;
    });
    expect((await request({ toolId: 'text-sentiment-pro', input: { text: 'good' } })).status).toBe(
      200,
    );
    expect(settledBetweenStatements).toBe(true);
    expect(
      await sqlite.db
        .prepare("SELECT COUNT(*) AS n FROM credit_events WHERE refund_of='old_spend'")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await sqlite.db.prepare('SELECT SUM(amount) AS balance FROM credit_events').first(),
    ).toEqual({ balance: 96 });
  });
});
