import { describe, expect, it } from 'vitest';
import { cronFromText, generateCronFromText } from '../../../src/tools/cron-from-text/index';
import type { ToolRunContext } from '../../../src/types';
const ctx = (): ToolRunContext => ({
  onProgress() {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'cron-fields',
});
async function run(params: Record<string, unknown>, files: File[] = []) {
  const output = await cronFromText.run(files, params, ctx());
  return JSON.parse(await (Array.isArray(output) ? output[0]! : output).text()) as {
    cron: string;
    nextRuns: string[];
    warning?: string;
  };
}
describe('structured five-field cron', () => {
  it('requires an IANA timezone rather than an Intl-supported fixed offset', async () => {
    await expect(
      run({ mode: 'fields', currentDate: '2026-01-02T00:00:00Z', timezone: '+01:00' }),
    ).rejects.toThrow('IANA');
  });
  it('uses DOM/DOW OR with an explicit anchor and timezone', async () => {
    const result = await run({
      mode: 'fields',
      minute: '0',
      hour: '0',
      dayOfMonth: '1',
      dayOfWeek: '1',
      timezone: 'UTC',
      currentDate: '2026-01-02T00:00:00.000Z',
    });
    expect(result.cron).toBe('0 0 1 * 1');
    expect(result.nextRuns).toEqual([
      '2026-01-05T00:00:00.000Z',
      '2026-01-12T00:00:00.000Z',
      '2026-01-19T00:00:00.000Z',
      '2026-01-26T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ]);
  });
  it('supports bounded numeric lists/ranges/steps and Sunday 7', async () => {
    expect(
      (
        await run({
          mode: 'fields',
          minute: '0,15-45/15',
          hour: '9-17/2',
          dayOfWeek: '7',
          currentDate: '2026-01-03T00:00:00Z',
          nextCount: 2,
        })
      ).nextRuns,
    ).toEqual(['2026-01-04T09:00:00.000Z', '2026-01-04T09:15:00.000Z']);
  });
  it.each([
    [
      '2026-03-07T00:00:00.000Z',
      '2',
      ['2026-03-07T07:30:00.000Z', '2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z'],
    ],
    [
      '2026-10-31T00:00:00.000Z',
      '1',
      ['2026-10-31T05:30:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'],
    ],
  ] as const)(
    'previews actual cron-parser DST behavior from %s',
    async (currentDate, hour, expected) => {
      expect(
        (
          await run({
            mode: 'fields',
            minute: '30',
            hour,
            currentDate,
            timezone: 'America/New_York',
            nextCount: 3,
          })
        ).nextRuns,
      ).toEqual(expected);
    },
  );
  it.each([
    { minute: '60' },
    { hour: '24' },
    { dayOfMonth: '0' },
    { month: '13' },
    { dayOfWeek: '8' },
    { minute: '*/0' },
    { minute: '2-1' },
    { minute: '1,,2' },
    { dayOfMonth: 'L' },
    { minute: '?' },
    { minute: '0;process.exit()' },
    { minute: '*'.repeat(129) },
    { nextCount: 0 },
    { nextCount: 51 },
    { nextCount: 1.5 },
    { timezone: 'Bogus/Zone' },
    { currentDate: '' },
    { currentDate: '2026-02-30T00:00:00Z' },
    { currentDate: '2026-01-01' },
    { mode: 'other' },
  ])('rejects invalid fields or explicit scheduling inputs %j', async (override) => {
    await expect(
      run({ mode: 'fields', currentDate: '2026-01-02T00:00:00Z', ...override }),
    ).rejects.toThrow();
  });
  it('rejects files in fields mode and retains the text helper with an L warning', async () => {
    await expect(
      run({ mode: 'fields', currentDate: '2026-01-02T00:00:00Z' }, [
        new File(['* * * * *'], 'schedule.txt'),
      ]),
    ).rejects.toThrow('files');
    expect(generateCronFromText('last day of the month at midnight').cron).toBe('0 0 L * *');
    expect((await run({ description: 'last day of the month at midnight' })).warning).toContain(
      'POSIX',
    );
  });
  it('settles an already aborted request without a done event', async () => {
    const controller = new AbortController();
    controller.abort();
    const events: string[] = [];
    await expect(
      cronFromText.run(
        [],
        { mode: 'fields', currentDate: '2026-01-02T00:00:00Z' },
        { ...ctx(), signal: controller.signal, onProgress: (p) => events.push(p.stage) },
      ),
    ).rejects.toThrow('Aborted');
    expect(events).not.toContain('done');
  });
});
