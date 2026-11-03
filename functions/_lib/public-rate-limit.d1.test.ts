import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { reserveDomainLookup, DomainAdmissionError } from './public-rate-limit';
import type { D1Database } from './env';

describe('actual local D1 admission transactions', () => {
  let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
  let db: D1Database;
  beforeAll(async () => {
    platform = await getPlatformProxy<{ DB: D1Database }>({ configPath: fileURLToPath(new URL('./test/domain-rate-wrangler.jsonc', import.meta.url)), persist: false });
    db = platform.env.DB;
    const schema = await readFile(new URL('../../migrations/0008_public_domain_limits.sql', import.meta.url), 'utf8');
    const statements = schema.match(/CREATE TABLE[\s\S]*?;\n|CREATE INDEX[^\n]+;\n|CREATE TRIGGER[\s\S]*?END;/g);
    if (!statements || statements.length !== 9 || schema.replace(/CREATE TABLE[\s\S]*?;\n|CREATE INDEX[^\n]+;\n|CREATE TRIGGER[\s\S]*?END;/g, '').trim())
      throw new Error('The exact migration must contain two tables, one index and six triggers.');
    const applied = await db.batch(statements.map(statement => db.prepare(statement)));
    expect(applied).toHaveLength(9); expect(applied.every(result => result.success)).toBe(true);
  }, 30000);
  afterAll(async () => { await platform?.dispose(); });
  beforeEach(async () => { await db.batch([db.prepare('DELETE FROM public_api_rate_windows'), db.prepare('DELETE FROM public_api_inflight_leases')]); });
  const signal = () => new AbortController().signal;
  const admit = (network: number) => reserveDomainLookup(db, 'synthetic-test-secret', `198.51.100.${network}`, signal());
  const rows = async () => ({ counters: (await db.prepare('SELECT * FROM public_api_rate_windows ORDER BY scope_key').all()).results, leases: (await db.prepare('SELECT * FROM public_api_inflight_leases ORDER BY token').all()).results });

  const sameMinute = async (operation: (measurement: {
    settled: (results: PromiseSettledResult<unknown>[]) => void;
    checkpoint: (stage: 'after-all-settled' | 'after-final-count') => Promise<void>;
  }) => Promise<void>) => {
    type Clock = { now_seconds: number; window_start: number };
    const startedAt = performance.now();
    let lastGateClock: Clock | undefined, startClock: Clock | undefined, endClock: Clock | undefined;
    let waited = false, failed = false, primary: unknown, diagnosticBytes = 0, diagnosticLines = 0;
    let counterTotal: number | undefined, leaseCount: number | undefined;
    let counters: { scope: string; window_start: number; count: number }[] | undefined;
    let settlements: { fulfilled: number; rejected: number; errors: { name: string; status: number | null; count: number }[] } | undefined;
    const checkpoints: { stage: string; clock: Clock }[] = [];
    const secondary: { name: string; status: number | null }[] = [];
    const errorSummary = (error: unknown) => ({
      name: error instanceof DomainAdmissionError ? 'DomainAdmissionError'
        : error instanceof Error && ['Error', 'AssertionError', 'TypeError'].includes(error.name) ? error.name : 'OtherError',
      status: error instanceof DomainAdmissionError && [429, 503].includes(error.status) ? error.status : null,
    });
    const retain = (error: unknown) => {
      if (!failed) { failed = true; primary = error; }
      else if (secondary.length < 4) secondary.push(errorSummary(error));
    };
    const readClock = async (): Promise<Clock> => {
      const clock = await db.prepare('SELECT unixepoch() AS now_seconds, (unixepoch() / 60) * 60 AS window_start').first<Clock>();
      if (!clock || !Number.isSafeInteger(clock.now_seconds) || !Number.isSafeInteger(clock.window_start)
        || clock.now_seconds < 0 || clock.window_start !== Math.floor(clock.now_seconds / 60) * 60)
        throw new Error('Native D1 clock shape is invalid.');
      return { now_seconds: clock.now_seconds, window_start: clock.window_start };
    };
    const emit = (phase: 'start' | 'final') => {
      const line = `public-d1-measurement ${JSON.stringify({ phase, waited, lastGateClock, startClock, checkpoints, endClock,
        elapsedMs: Math.round(performance.now() - startedAt), settlements, counterTotal, counters, leaseCount,
        counterSummariesComplete: counterTotal === undefined || counters === undefined ? null : counterTotal <= 61 && counters.length === counterTotal,
        failed, primary: failed ? errorSummary(primary) : null, secondary })}\n`;
      const bytes = Buffer.byteLength(line);
      if (diagnosticLines >= 2 || diagnosticBytes + bytes > 16384)
        throw new Error('Native D1 measurement diagnostic bound exceeded.');
      diagnosticLines++;
      diagnosticBytes += bytes;
      process.stdout.write(line);
    };
    const checkpoint = async (stage: 'after-all-settled' | 'after-final-count') => {
      const clock = await readClock();
      checkpoints.push({ stage, clock });
      if (clock.window_start !== startClock?.window_start)
        throw new Error('Native D1 measurement crossed its starting minute.');
    };
    let startEmitted = false;
    try {
      const deadline = performance.now() + 11000;
      let gateTimer: ReturnType<typeof setTimeout> | undefined, boundaryTimer: ReturnType<typeof setTimeout> | undefined;
      let gateClosed = false;
      const checkGate = () => {
        if (gateClosed || performance.now() >= deadline)
          throw new Error('Native D1 admission-start gate exceeded eleven seconds.');
      };
      const timeout = new Promise<never>((_resolve, reject) => {
        gateTimer = setTimeout(() => reject(new Error('Native D1 admission-start gate exceeded eleven seconds.')), 11000);
      });
      const gate = (async () => {
        lastGateClock = await readClock();
        checkGate();
        const remaining = lastGateClock.window_start + 60 - lastGateClock.now_seconds;
        if (remaining < 10) {
          waited = true;
          await new Promise<void>((resolve) => { boundaryTimer = setTimeout(resolve, remaining * 1000); });
          checkGate();
          lastGateClock = await readClock();
          checkGate();
        }
        if (lastGateClock.window_start + 60 - lastGateClock.now_seconds < 10)
          throw new Error('Native D1 admission-start gate has fewer than ten seconds remaining.');
        return lastGateClock;
      })();
      try { startClock = await Promise.race([gate, timeout]); }
      finally { gateClosed = true; clearTimeout(gateTimer); clearTimeout(boundaryTimer); }
      startEmitted = true;
      emit('start');
      await operation({ checkpoint, settled: (results) => {
        const errors = new Map<string, { name: string; status: number | null; count: number }>();
        for (const result of results) if (result.status === 'rejected') {
          const summary = errorSummary(result.reason), key = JSON.stringify(summary), prior = errors.get(key);
          errors.set(key, { ...summary, count: (prior?.count ?? 0) + 1 });
        }
        settlements = { fulfilled: results.filter((result) => result.status === 'fulfilled').length,
          rejected: results.filter((result) => result.status === 'rejected').length, errors: [...errors.values()] };
      } });
    } catch (error) { retain(error); }
    if (!startEmitted) { try { emit('start'); } catch (error) { retain(error); } }
    try {
      endClock = await readClock();
      if (startClock && endClock.window_start !== startClock.window_start)
        throw new Error('Native D1 measurement crossed its starting minute.');
    } catch (error) { retain(error); }
    try {
      const total = await db.prepare('SELECT COUNT(*) AS total FROM public_api_rate_windows').first<{ total: number }>();
      if (!total || !Number.isSafeInteger(total.total) || total.total < 0) throw new Error('Native D1 counter total is invalid.');
      counterTotal = total.total;
      const result = await db.prepare("SELECT CASE WHEN scope_key='global' THEN 'global' ELSE 'network' END AS scope, window_start, count FROM public_api_rate_windows ORDER BY scope_key LIMIT 61").all<{ scope: string; window_start: number; count: number }>();
      if (!Array.isArray(result.results)) throw new Error('Native D1 counter summaries are unavailable.');
      counters = result.results;
      if (counterTotal > 61 || counters.length !== counterTotal) throw new Error('Native D1 counter summaries are incomplete.');
    } catch (error) { retain(error); }
    try {
      const leases = await db.prepare('SELECT COUNT(*) AS total FROM public_api_inflight_leases').first<{ total: number }>();
      if (!leases || !Number.isSafeInteger(leases.total) || leases.total < 0) throw new Error('Native D1 lease count is invalid.');
      leaseCount = leases.total;
    } catch (error) { retain(error); }
    try { emit('final'); } catch (error) { retain(error); }
    if (failed) throw primary;
  };

  it('rolls back denied network admissions so another network keeps global capacity', async () => {
    await sameMinute(async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { const lease = await admit(1); expect(attempt).toBeLessThan(6); await lease.release(); }
      catch (error) { expect(attempt).toBeGreaterThanOrEqual(6); expect(error).toBeInstanceOf(DomainAdmissionError); expect((error as DomainAdmissionError).status).toBe(429); }
    }
    const global = await db.prepare("SELECT count FROM public_api_rate_windows WHERE scope_key='global'").first<{ count: number }>();
    expect(global?.count).toBe(6);
    const next = await admit(2); await next.release();
    expect((await db.prepare("SELECT count FROM public_api_rate_windows WHERE scope_key='global'").first<{ count: number }>())?.count).toBe(7);
    expect(JSON.stringify(await rows())).not.toContain('198.51.100');
    });
  }, 30000);

  it('admits exactly eight concurrent leases and rolls back the ninth complete batch', async () => {
    await sameMinute(async (measurement) => {
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => admit(index + 1)));
    measurement.settled(attempts);
    const admitted = attempts.filter(result => result.status === 'fulfilled');
    expect(admitted).toHaveLength(8);
    const state = await rows(); expect(state.leases).toHaveLength(8); expect(state.counters).toHaveLength(9);
    expect((await db.prepare("SELECT count FROM public_api_rate_windows WHERE scope_key='global'").first<{ count: number }>())?.count).toBe(8);
    for (const result of admitted) if (result.status === 'fulfilled') await result.value.release();
    expect((await rows()).leases).toHaveLength(0);
    });
  }, 30000);

  it('admits six of sixty simultaneous requests from one network without burning global capacity', async () => {
    await sameMinute(async (measurement) => {
    const attempts = await Promise.allSettled(Array.from({ length: 60 }, async () => {
      const lease = await admit(1);
      await lease.release();
    }));
    measurement.settled(attempts);
    await measurement.checkpoint('after-all-settled');
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(6);
    for (const result of attempts) if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 429 });
    const state = await rows();
    expect(state.leases).toHaveLength(0);
    expect(state.counters).toHaveLength(2);
    expect(state.counters).toEqual(expect.arrayContaining([expect.objectContaining({ scope_key: 'global', count: 6 })]));
    const other = await admit(2);
    await other.release();
    const finalGlobal = await db.prepare("SELECT count FROM public_api_rate_windows WHERE scope_key='global'").first<{ count: number }>();
    await measurement.checkpoint('after-final-count');
    expect(finalGlobal?.count).toBe(7);
    });
  }, 30000);

  it('preserves the original lease on token collision and gives release exact ownership', async () => {
    await sameMinute(async () => {
    const token = '1'.repeat(32);
    const first = await reserveDomainLookup(db, 'synthetic-test-secret', '198.51.100.1', signal(), () => token);
    const before = await rows();
    await expect(reserveDomainLookup(db, 'synthetic-test-secret', '198.51.100.2', signal(), () => token)).rejects.toMatchObject({ status: 503 });
    expect(await rows()).toEqual(before);
    const second = await admit(3);
    await first.release(); await first.release(); expect((await rows()).leases).toHaveLength(1);
    await second.release(); expect((await rows()).leases).toHaveLength(0);
    });
  }, 30000);

  it('keeps the global sixty ceiling and creates no rows for the sixty-first network', async () => {
    await sameMinute(async () => {
    for (let index = 1; index <= 60; index++) { const lease = await admit(index); await lease.release(); }
    const before = await rows(); expect(before.counters).toHaveLength(61);
    await expect(admit(61)).rejects.toMatchObject({ status: 429 });
    expect(await rows()).toEqual(before);
    });
  }, 30000);

  it('uses DB clock triggers to reject old windows, and fails closed on missing triggers', async () => {
    const clock = await db.prepare('SELECT (unixepoch()/60)*60 AS window_start').first<{ window_start: number }>();
    expect(clock).not.toBeNull();
    await expect(db.batch([
      db.prepare("INSERT INTO public_api_rate_windows VALUES ('domain-age',?,'global',1)").bind(clock!.window_start),
      db.prepare("INSERT INTO public_api_rate_windows VALUES ('domain-age',?, ?,1)").bind(clock!.window_start - 60, 'a'.repeat(64)),
    ])).rejects.toThrow('DOMAIN_AGE_WINDOW_CHANGED');
    expect((await rows()).counters).toHaveLength(0);
    await db.prepare('DROP TRIGGER public_api_lease_clock').run();
    await expect(admit(1)).rejects.toMatchObject({ status: 503 });
    expect((await rows()).counters).toHaveLength(0);
    await db.prepare("CREATE TRIGGER public_api_lease_clock BEFORE INSERT ON public_api_inflight_leases WHEN NEW.created_at != unixepoch() OR NEW.expires_at != unixepoch() + 30 BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_LEASE_CLOCK'); END;").run();
  }, 30000);
});
