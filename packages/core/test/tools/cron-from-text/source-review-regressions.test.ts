import { describe, expect, it } from 'vitest';
import { CronExpressionParser } from 'cron-parser';
import { cronFromText, generateCronFromText } from '../../../src/tools/cron-from-text/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'cron-source-review-regressions',
  onProgress() {},
});

function expectNoMatch(description: string) {
  const result = generateCronFromText(description);
  expect.soft(result.confidence).toBe('no-match');
  expect(result.cron).toBe('');
}

describe('cron source review regressions', () => {
  it.each([
    ['at 8:30 on the 15th of the month', '30 8 15 * *'],
    ['at 10:30 on the 1st of the month', '30 10 1 * *'],
  ])('keeps the clock separate from an explicit calendar date: %s', (description, cron) => {
    expect(generateCronFromText(description).cron).toBe(cron);
  });

  it('never silently turns every two months into every month', () => {
    const result = generateCronFromText('every 2 months');
    // A calendar month-field step is representable. Unsupported wording may
    // instead take the existing explicit no-match path, without a cron line.
    if (result.confidence === 'no-match') {
      expect(result.cron).toBe('');
      return;
    }
    expect.soft(result.cron).toBe('0 0 1 */2 *');
    expect(result.explanation).toMatch(/2\s+months/i);
  });

  it.each([
    'every 2 weeks',
    'every 90 minutes',
    'every 48 hours',
    'first monday of the month at 9am',
    'last monday of the month at 9am',
    '1st monday of the month at 9am',
    'every 10 minutes at 9am',
    'the 32nd of the month at midnight',
    '1st of the month and 15th of the month at 9am',
    'at 9am and 5pm',
    'every 2 days on monday at 9am',
    'every 0 days at 9am',
    'every -2 days at 9am',
    'every 1.5 hours at 9am',
  ])(
    'refuses unsupported or conflicting wording instead of a different schedule: %s',
    expectNoMatch,
  );

  it('combines a weekday group and an explicitly added Saturday', () => {
    expect(generateCronFromText('weekdays and saturday at 9am').cron).toBe('0 9 * * 1,2,3,4,5,6');
  });

  it('retains the calendar day step in the explanation when adding a time', () => {
    const result = generateCronFromText('every 2 days at 9am');
    expect(result.cron).toBe('0 9 */2 * *');
    expect(result.explanation).toMatch(/every\s+2\s+days/i);
  });

  it('warns that a nondivisor minute step resets at the next hour', async () => {
    const output = (await cronFromText.run(
      [],
      { description: 'every 45 minutes' },
      context(),
    )) as Blob[];
    const result = JSON.parse(await output[0]!.text()) as {
      cron: string;
      warning?: string;
    };
    expect(result.cron).toBe('*/45 * * * *');
    expect(result.warning).toMatch(/reset|restart/i);
    expect(result.warning).toMatch(/hour|field/i);
    const expression = CronExpressionParser.parse(result.cron, {
      currentDate: '2026-01-01T00:44:00Z',
      tz: 'UTC',
    });
    expect([expression.next().toISOString(), expression.next().toISOString()]).toEqual([
      '2026-01-01T00:45:00.000Z',
      '2026-01-01T01:00:00.000Z',
    ]);
  });

  it('demonstrates why DOM 1 plus Monday cannot mean first Monday under OR', async () => {
    const output = (await cronFromText.run(
      [],
      {
        mode: 'fields',
        minute: '0',
        hour: '9',
        dayOfMonth: '1',
        dayOfWeek: '1',
        currentDate: '2026-03-31T12:00:00Z',
        timezone: 'UTC',
        nextCount: 3,
      },
      context(),
    )) as Blob[];
    const result = JSON.parse(await output[0]!.text()) as {
      nextRuns: string[];
      dayMatching: string;
    };
    expect(result.nextRuns).toEqual([
      '2026-04-01T09:00:00.000Z',
      '2026-04-06T09:00:00.000Z',
      '2026-04-13T09:00:00.000Z',
    ]);
    expect(result.dayMatching).toContain('OR');
  });

  it('demonstrates that L plus Monday also schedules ordinary Mondays', () => {
    const expression = CronExpressionParser.parse('0 9 L * 1', {
      currentDate: '2026-03-31T12:00:00Z',
      tz: 'UTC',
      strict: false,
    });
    expect([expression.next().toISOString(), expression.next().toISOString()]).toEqual([
      '2026-04-06T09:00:00.000Z',
      '2026-04-13T09:00:00.000Z',
    ]);
  });

  it('keeps calendar steps distinct from a constant elapsed two-day cadence', () => {
    const expression = CronExpressionParser.parse('0 9 */2 * *', {
      currentDate: '2026-01-30T12:00:00Z',
      tz: 'UTC',
    });
    expect([expression.next().toISOString(), expression.next().toISOString()]).toEqual([
      '2026-01-31T09:00:00.000Z',
      '2026-02-01T09:00:00.000Z',
    ]);
  });
});
