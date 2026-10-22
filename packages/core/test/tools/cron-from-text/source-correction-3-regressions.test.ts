import { describe, expect, it } from 'vitest';
import { cronFromText, generateCronFromText } from '../../../src/tools/cron-from-text/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const refusedDescriptions = [
  'every other monday at 9am',
  'every second monday at 9am',
  'biweekly on monday at 9am',
  'fortnightly on monday at 9am',
  'twice on monday at 9am',
  'after monday at 9am',
  'around 9am on monday',
  'every monday except holidays at 9am',
  'every year on monday at 9am',
  'every monday 9',
  'monday 0930',
  'every monday at 9am for 2 hours',
  'every monday-friday at 9am',
  'mon-fri at 9am',
  'mon–fri at 9am',
  'mon—fri at 9am',
  'mon~fri at 9am',
  'monday..friday at 9am',
  'monday.friday at 9am',
  '9am-5pm on monday',
  'o-9am-n monday',
  'every monday at 9am кроме праздников',
  'every monday at 9am 除节假日外',
  'every monday at 9am (кроме праздников)',
  'every day thus at 9am',
  'thus at 9am',
  'daily at 9am',
  'at 9am each day',
  'weekly at 9am',
  'monday or friday at 9am',
  '1th of the month at 9am',
  '2st of the month at 9am',
  '3nd of the month at 9am',
  '11st of the month at 9am',
  '12nd of the month at 9am',
  '13rd of the month at 9am',
  '21th of the month at 9am',
  '22th of the month at 9am',
  '23th of the month at 9am',
  '15st of the month at 9am',
];

describe('cron correction 3 — complete closed grammar, no discarded constraints', () => {
  it.each(refusedDescriptions)('refuses the complete description %s', (description) => {
    expect(generateCronFromText(description)).toMatchObject({
      cron: '',
      confidence: 'no-match',
      fields: { minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '' },
      matchedTokens: [],
    });
  });

  it('returns the same refusal through the actual public tool JSON artifact', async () => {
    const ctx: ToolRunContext = {
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'cron-source-correction-3',
      onProgress: () => {},
    };
    const output = await cronFromText.run(
      [],
      { mode: 'text', description: 'every other monday at 9am' },
      ctx,
    );
    const blob = Array.isArray(output) ? output[0] : output;
    if (!blob) throw new Error('Missing cron result.');
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toMatchObject({ cron: '', confidence: 'no-match' });
  });
});

describe('cron correction 3 — preserved complete supported schedules', () => {
  it.each([
    ['every 5 minutes', '*/5 * * * *'],
    ['every minute', '* * * * *'],
    ['every 2 hours', '0 */2 * * *'],
    ['every hour', '0 * * * *'],
    ['every 2 days', '0 0 */2 * *'],
    ['every day at midnight', '0 0 * * *'],
    ['every day at noon', '0 12 * * *'],
    ['every day at 9:30 pm', '30 21 * * *'],
    ['every week on monday', '0 0 * * 1'],
    ['every day on monday', '0 0 * * 1'],
    ['every month at noon', '0 12 1 * *'],
    ['every monday at 9am', '0 9 * * 1'],
    ['at 9am on monday', '0 9 * * 1'],
    ['at 8:30am on weekdays', '30 8 * * 1,2,3,4,5'],
    ['weekends at noon', '0 12 * * 0,6'],
    ['every mon and fri at 6pm', '0 18 * * 1,5'],
    ['every thu at 9am', '0 9 * * 4'],
    ['every thurs at 9am', '0 9 * * 4'],
    ['every thursdays at 9am', '0 9 * * 4'],
    ['every monday and mondays at 9am', '0 9 * * 1'],
    ['weekdays and monday at 9am', '0 9 * * 1,2,3,4,5'],
    ['Run every Monday, and Friday at 6pm.', '0 18 * * 1,5'],
    ['first of the month at midnight', '0 0 1 * *'],
    ['last day of the month at midnight', '0 0 L * *'],
    ['1st of the month at 9am', '0 9 1 * *'],
    ['2nd of the month at 9am', '0 9 2 * *'],
    ['3rd of the month at 9am', '0 9 3 * *'],
    ['11th of the month at 9am', '0 9 11 * *'],
    ['12th of the month at 9am', '0 9 12 * *'],
    ['13th of the month at 9am', '0 9 13 * *'],
    ['21st of the month at 9am', '0 9 21 * *'],
    ['22nd of the month at 9am', '0 9 22 * *'],
    ['23rd of the month at 9am', '0 9 23 * *'],
    ['15 of the month at 9am', '0 9 15 * *'],
  ])('keeps %s as the exact schedule %s', (description, cron) => {
    const result = generateCronFromText(description);
    expect(result.cron).toBe(cron);
    expect(result.confidence).not.toBe('no-match');
    expect(result.fields).toEqual(
      Object.fromEntries(
        ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'].map((key, index) => [
          key,
          cron.split(' ')[index],
        ]),
      ),
    );
  });
});

describe('cron correction 3 — honest bare calendar restrictions', () => {
  it.each([
    ['every monday', '* * * * 1'],
    ['weekdays', '* * * * 1,2,3,4,5'],
    ['15th of the month', '* * 15 * *'],
    ['last day of the month', '* * L * *'],
  ])('labels %s explicitly as every minute with medium confidence', (description, cron) => {
    const result = generateCronFromText(description);
    expect(result.cron).toBe(cron);
    expect(result.confidence).toBe('medium');
    expect(result.explanation).toMatch(/every minute/i);
  });

  it.each(['every week on monday', 'every day on monday'])(
    'keeps the interval midnight fields and avoids an every-minute explanation for %s',
    (description) => {
      const result = generateCronFromText(description);
      expect(result.cron).toBe('0 0 * * 1');
      expect(result.explanation).not.toMatch(/every minute/i);
    },
  );
});
