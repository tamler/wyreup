import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from './env';
import { reserveProCredits, setSetting, getSetting } from './limits';
import { createSqliteTestDb } from './test/sqlite';

const NOW = Date.UTC(2026, 8, 10, 12);
describe('atomic Pro reservation on SQLite', () => {
  let sqlite: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let env: Env;
  let sequence = 0;
  beforeEach(async () => {
    sqlite = await createSqliteTestDb();
    env = { DB: sqlite.db } as Env;
    await sqlite.exec(
      "INSERT INTO users(id,email,created_at) VALUES ('user','user@example.com',0),('other','other@example.com',0); INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES ('grant','user','grant',1000,0),('grant2','other','grant',1000,0);",
    );
  });
  afterEach(async () => {
    await sqlite.close();
  });
  const reserve = (userId = 'user', cost = 1, now = NOW) =>
    reserveProCredits(env, {
      userId,
      cost,
      toolId: 'text-sentiment-pro',
      spendId: `spend_${sequence++}`,
      now,
    });

  it('only admits one concurrent request with one platform credit left', async () => {
    await setSetting(env, 'daily_spend_cap_credits', 1, 'user');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => reserve(i % 2 ? 'user' : 'other')),
    );
    expect(results.filter((result) => result === null)).toHaveLength(1);
  });
  it('only admits five pending requests and successful history releases capacity', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve()));
    expect(results.filter((result) => result === null)).toHaveLength(5);
    await sqlite.exec(
      "INSERT INTO run_history(id,user_id,tool_id,tier,ran_at,spend_event_id) SELECT 'history_'||id,user_id,tool_id,'pro',created_at,id FROM credit_events WHERE kind='spend';",
    );
    expect(await reserve()).toBeNull();
  });
  it('refunds retain failed slots until UTC midnight', async () => {
    for (let i = 0; i < 5; i++) expect(await reserve()).toBeNull();
    await sqlite.exec(
      "INSERT INTO credit_events(id,user_id,kind,amount,created_at,refund_of) SELECT 'refund_'||id,user_id,'refund',-amount,created_at,id FROM credit_events WHERE kind='spend';",
    );
    expect((await reserve())?.status).toBe(429);
    expect(await reserve('user', 1, NOW + 86400000)).toBeNull();
  });
  it('atomically protects the balance', async () => {
    await sqlite.exec("UPDATE credit_events SET amount=1 WHERE id='grant';");
    expect(
      (await Promise.all(Array.from({ length: 10 }, () => reserve()))).filter(
        (result) => result === null,
      ),
    ).toHaveLength(1);
  });
  it('retains gross refunded spend in platform cap', async () => {
    await setSetting(env, 'daily_spend_cap_credits', 1, 'user');
    expect(await reserve()).toBeNull();
    await sqlite.exec(
      "INSERT INTO credit_events(id,user_id,kind,amount,created_at,refund_of) SELECT 'refund_'||id,user_id,'refund',-amount,created_at,id FROM credit_events WHERE kind='spend';",
    );
    expect((await reserve('other'))?.status).toBe(503);
  });
  it.each(['abc', 'NaN', 'Infinity', '-1', '', '01', '1.5', '1e1', '999999999999999999999'])(
    'fails closed for corrupted switch %s',
    async (value) => {
      await sqlite.db
        .prepare("UPDATE system_settings SET value=? WHERE key='system_disabled'")
        .bind(value)
        .run();
      expect((await reserve())?.status).toBe(503);
    },
  );
  it('uses missing defaults and permits canonical disabled cap', async () => {
    await sqlite.exec('DELETE FROM system_settings;');
    expect(await reserve()).toBeNull();
    await setSetting(env, 'daily_spend_cap_credits', 0, 'user');
    expect(await reserve()).toBeNull();
    await setSetting(env, 'system_disabled', 1, 'user');
    expect((await reserve())?.status).toBe(503);
  });
  it('enforces the rolling rate limit even when every earlier attempt succeeded', async () => {
    for (let i = 0; i < 29; i++) {
      await sqlite.db
        .prepare(
          "INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES(?, 'user','spend',-1,?)",
        )
        .bind(`seed_${i}`, NOW)
        .run();
    }
    await sqlite.exec(
      "INSERT INTO run_history(id,user_id,tool_id,tier,ran_at,spend_event_id) SELECT 'history_'||id,user_id,'text-sentiment-pro','pro',created_at,id FROM credit_events WHERE kind='spend';",
    );
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve()));
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(await reserve('user', 1, NOW + 60_001)).toBeNull();
  });
  it.each(['abc', 'NaN', 'Infinity', '-1', '', '01', '1.5', '1e1', '10000001'])(
    'uses safe cap fallback consistently for %s',
    async (value) => {
      await sqlite.db
        .prepare("UPDATE system_settings SET value=? WHERE key='daily_spend_cap_credits'")
        .bind(value)
        .run();
      expect(await getSetting(env, 'daily_spend_cap_credits')).toBe(5000);
      await sqlite.db
        .prepare(
          "INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('platform','other','spend',-5000,?)",
        )
        .bind(NOW)
        .run();
      expect((await reserve())?.status).toBe(503);
    },
  );
  it.each([NaN, Infinity, -1, 0.5, 10_000_001])(
    'rejects invalid setting writes %s',
    async (value) => {
      await expect(setSetting(env, 'daily_spend_cap_credits', value, 'user')).rejects.toThrow();
      expect(await getSetting(env, 'daily_spend_cap_credits')).toBe(5000);
    },
  );
  it('uses admission indexes for spend, rate, and success lookups', async () => {
    const queries = [
      [
        "SELECT SUM(-amount) FROM credit_events WHERE kind='spend' AND created_at>=0",
        'idx_credit_kind_created',
      ],
      [
        "SELECT COUNT(*) FROM credit_events WHERE user_id='user' AND kind='spend' AND created_at>=0",
        'idx_credit_user_kind_created',
      ],
      ["SELECT 1 FROM run_history WHERE spend_event_id='spend'", 'idx_history_spend'],
    ];
    for (const [query, index] of queries) {
      const plan = await sqlite.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all<{ detail: string }>();
      expect(plan.results?.map((row) => row.detail).join(' ')).toContain(index);
    }
  });
});
