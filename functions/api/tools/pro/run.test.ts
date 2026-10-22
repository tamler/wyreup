import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './run';
import type { Env, D1Result } from '../../../_lib/env';
import type { PagesFunctionContext } from '../../../_lib/types';
import { PRICING } from '../../../_lib/pricing';
import { createSqliteTestDb } from '../../../_lib/test/sqlite';
import type * as Auth from '../../../_lib/auth';

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
