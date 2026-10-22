import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWyreupMcpServer } from '../src/server.js';

type Result = { isError?: boolean; content: { type: string; text: string }[] };
async function call(name: string, params: unknown): Promise<Result> {
  // This exercises the actual handler and real module in the explicitly selected debug realm.
  // Default isolated-worker acceptance is owned by the separate packaged gates.
  vi.stubEnv('WYREUP_DISABLE_WORKER_ISOLATION', '1');
  vi.stubEnv('WYREUP_API_KEY', undefined);
  const server = await createWyreupMcpServer();
  try {
    const handlers = (
      server as unknown as {
        _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<Result>>;
      }
    )._requestHandlers;
    const handler = handlers.get('tools/call');
    if (!handler) throw new Error('Missing actual tools/call handler.');
    return await handler({ method: 'tools/call', params: { name, arguments: { params } } }, {});
  } finally {
    await server.close();
  }
}
afterEach(() => vi.unstubAllEnvs());
describe('actual MCP handler parameter admission (debug in-process, not isolated worker)', () => {
  it('keeps the cron minute string and exact next-run artifact', async () => {
    const result = await call('cron-from-text', {
      mode: 'fields',
      minute: '5',
      currentDate: '2026-01-01T00:00:00Z',
      nextCount: 1,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      cron: '5 * * * *',
      nextRuns: ['2026-01-01T00:05:00.000Z'],
    });
  });
  it('requires an active numeric value and preserves exact zero-rate loan arithmetic', async () => {
    const refused = await call('loan-calculator', { APR: null });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain('APR');
    const result = await call('loan-calculator', { APR: 0, principal: 1200, months: 12 });
    expect(result.isError).toBeFalsy();
    const artifact = JSON.parse(result.content[0]!.text) as {
      scheduledPayment: number;
      totalInterest: number;
      totalPaid: number;
      schedule: { payment: number }[];
    };
    expect(artifact.scheduledPayment).toBe(100);
    expect(artifact.totalInterest).toBe(0);
    expect(artifact.schedule).toHaveLength(12);
    expect(artifact.schedule.every((row) => row.payment === 100)).toBe(true);
    expect(artifact.totalPaid).toBe(1200);
  });
  it('emits literal generator text and rejects arrays in place of row strings', async () => {
    const groups = [{ userAgent: 'Bot', rule: 'Allow', path: '/public' }];
    const result = await call('robots-txt-generator', {
      groupsJson: JSON.stringify(groups),
      sitemapsJson: '[]',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toBe('User-agent: Bot\nAllow: /public\n');
    const refused = await call('robots-txt-generator', { groupsJson: groups });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain('Expected text');
  });
  it('refuses a real web-only capture tool and a nonobject parameter root', async () => {
    expect((await call('gamepad-tester', {})).isError).toBe(true);
    const result = await call('cron-from-text', []);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('JSON object');
  });
});
