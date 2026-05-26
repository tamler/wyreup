import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_LIMITS,
  enforceLimits,
  getSetting,
  setSetting,
  startOfUtcDay,
} from './limits';
import type { Env } from './env';

// ── Test doubles ───────────────────────────────────────────────────────────
//
// Mock D1 via the prepared-statement chain. enforceLimits() issues at
// most two distinct queries (settings IN-clause + an account-wide spend
// sum), so the mock branches on SQL text.

interface MockState {
  settings: Record<string, string>;
  totalSpend: number;
}

function mockEnv(state: Partial<MockState> = {}): { env: Env; state: MockState } {
  const s: MockState = {
    settings: state.settings ?? {},
    totalSpend: state.totalSpend ?? 0,
  };

  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM system_settings') && sql.includes('WHERE key = ?')) {
          const key = String(args[0]);
          return s.settings[key] != null ? { value: s.settings[key] } : null;
        }
        if (sql.includes('total_spend')) {
          return { total_spend: s.totalSpend };
        }
        return null;
      }),
      all: vi.fn(async () => {
        if (sql.includes('FROM system_settings') && sql.includes('WHERE key IN')) {
          const keys = args.map(String);
          return {
            results: keys
              .filter((k) => s.settings[k] != null)
              .map((k) => ({ key: k, value: s.settings[k] })),
          };
        }
        return { results: [] };
      }),
      run: vi.fn(async () => {
        if (sql.includes('INSERT INTO system_settings')) {
          const [key, value] = args as [string, string];
          s.settings[key] = value;
        }
        return { meta: { changes: 1 } };
      }),
    })),
  }));

  return { env: { DB: { prepare } } as unknown as Env, state: s };
}

const USER = { id: 'usr_abc' };

describe('startOfUtcDay', () => {
  it('returns 00:00 UTC for a known timestamp', () => {
    const t = Date.UTC(2026, 4, 26, 15, 23, 45);
    expect(startOfUtcDay(t)).toBe(Date.UTC(2026, 4, 26));
  });

  it('returns the same day boundary for any time during the day', () => {
    const morning = Date.UTC(2026, 4, 26, 0, 0, 1);
    const evening = Date.UTC(2026, 4, 26, 23, 59, 59);
    expect(startOfUtcDay(morning)).toBe(startOfUtcDay(evening));
  });
});

describe('getSetting', () => {
  it('returns the default when no row exists', async () => {
    const { env } = mockEnv();
    expect(await getSetting(env, 'daily_spend_cap_credits')).toBe(
      DEFAULT_LIMITS.daily_spend_cap_credits,
    );
    expect(await getSetting(env, 'system_disabled')).toBe(DEFAULT_LIMITS.system_disabled);
  });

  it('returns the stored value when a row exists', async () => {
    const { env } = mockEnv({ settings: { daily_spend_cap_credits: '9999' } });
    expect(await getSetting(env, 'daily_spend_cap_credits')).toBe(9999);
  });

  it('falls back to the default when the stored value is not numeric', async () => {
    const { env } = mockEnv({ settings: { daily_spend_cap_credits: 'banana' } });
    expect(await getSetting(env, 'daily_spend_cap_credits')).toBe(
      DEFAULT_LIMITS.daily_spend_cap_credits,
    );
  });
});

describe('setSetting', () => {
  it('upserts a value', async () => {
    const { env, state } = mockEnv();
    await setSetting(env, 'daily_spend_cap_credits', 1234, 'admin_user_id');
    expect(state.settings.daily_spend_cap_credits).toBe('1234');
  });
});

describe('enforceLimits', () => {
  it('passes when nothing is configured and no spend has occurred', async () => {
    const { env } = mockEnv();
    expect(await enforceLimits(env, USER, 3)).toBeNull();
  });

  it('blocks with 503 when system_disabled = 1', async () => {
    const { env } = mockEnv({ settings: { system_disabled: '1' } });
    const res = await enforceLimits(env, USER, 3);
    expect(res?.status).toBe(503);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/temporarily disabled/i);
  });

  it('blocks with 503 when the account-wide cap would be exceeded by this run', async () => {
    const { env } = mockEnv({
      settings: { daily_spend_cap_credits: '100' },
      totalSpend: 99,
    });
    const res = await enforceLimits(env, USER, 3);
    expect(res?.status).toBe(503);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/daily platform spend cap/i);
  });

  it('passes when account-wide spend + cost equals cap exactly', async () => {
    const { env } = mockEnv({
      settings: { daily_spend_cap_credits: '100' },
      totalSpend: 97,
    });
    expect(await enforceLimits(env, USER, 3)).toBeNull();
  });

  it('treats a cap of 0 as disabled (no enforcement on that layer)', async () => {
    const { env } = mockEnv({
      settings: { daily_spend_cap_credits: '0' },
      totalSpend: 999_999,
    });
    expect(await enforceLimits(env, USER, 3)).toBeNull();
  });

  it('does not query the spend sum when the cap is disabled (0)', async () => {
    const { env } = mockEnv({
      settings: { daily_spend_cap_credits: '0' },
    });
    await enforceLimits(env, USER, 3);
    const prepare = env.DB.prepare as unknown as ReturnType<typeof vi.fn>;
    const calls = prepare.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.every((sql) => sql.includes('system_settings'))).toBe(true);
  });

  it('kill switch is checked before the spend cap (short-circuits)', async () => {
    const { env } = mockEnv({
      settings: {
        system_disabled: '1',
        daily_spend_cap_credits: '100',
      },
      totalSpend: 50, // under cap; cap check would pass
    });
    const res = await enforceLimits(env, USER, 3);
    expect(res?.status).toBe(503);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toMatch(/temporarily disabled/i);
  });
});
