import { describe, it, expect, vi } from 'vitest';
import { onRequestPost } from './lemonsqueezy';
import { hmacSha256Hex } from '../../_lib/crypto';
import type { Env } from '../../_lib/env';

const SECRET = 'test-webhook-secret';

// Mock D1: the refund path issues a users existence check, a SELECT of the
// original purchase row, then the refund INSERT. We branch on SQL text and
// record the args bound to the INSERT so we can assert which user_id is used.
interface MockState {
  userExists: boolean;
  purchase: { amount: number; user_id: string } | null;
  refundInsertArgs: unknown[] | null;
}

function mockEnv(state: Partial<MockState> = {}): { env: Env; state: MockState } {
  const s: MockState = {
    userExists: state.userExists ?? true,
    purchase: state.purchase ?? null,
    refundInsertArgs: null,
  };

  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(() => {
        if (sql.includes('FROM users WHERE id = ?')) {
          return Promise.resolve(s.userExists ? { ok: 1 } : null);
        }
        if (sql.includes("kind = 'purchase'")) {
          return Promise.resolve(s.purchase);
        }
        return Promise.resolve(null);
      }),
      run: vi.fn(() => {
        if (sql.includes('INSERT OR IGNORE INTO credit_events')) {
          s.refundInsertArgs = args;
        }
        return Promise.resolve({ meta: { changes: 1 } });
      }),
    })),
  }));

  return {
    env: { DB: { prepare }, LS_WEBHOOK_SECRET: SECRET } as unknown as Env,
    state: s,
  };
}

async function signedRequest(body: object) {
  const text = JSON.stringify(body);
  const sig = await hmacSha256Hex(SECRET, text);
  return new Request('https://wyreup.com/api/webhooks/lemonsqueezy', {
    method: 'POST',
    headers: { 'X-Signature': sig },
    body: text,
  });
}

describe('order_refunded handler', () => {
  it('debits the original purchaser, not the payload custom_data.userId', async () => {
    const { env, state } = mockEnv({
      userExists: true,
      // Original purchase belongs to usr_real.
      purchase: { amount: 480, user_id: 'usr_real' },
    });

    const request = await signedRequest({
      meta: { event_name: 'order_refunded', custom_data: { userId: 'usr_attacker' } },
      data: { id: 'ord_123' },
    });

    const res = await onRequestPost({ request, env } as never);
    expect(res.status).toBe(200);

    // bind order: (id, user_id, amount, ls_order_id, note, created_at)
    expect(state.refundInsertArgs).not.toBeNull();
    const args = state.refundInsertArgs as unknown[];
    expect(args[1]).toBe('usr_real');
    expect(args[1]).not.toBe('usr_attacker');
    expect(args[2]).toBe(-480);
  });

  it('acks without inserting when the original purchase is missing', async () => {
    const { env, state } = mockEnv({ userExists: true, purchase: null });
    const request = await signedRequest({
      meta: { event_name: 'order_refunded', custom_data: { userId: 'usr_x' } },
      data: { id: 'ord_404' },
    });
    const res = await onRequestPost({ request, env } as never);
    expect(res.status).toBe(200);
    expect(state.refundInsertArgs).toBeNull();
  });
});
