import { describe, expect, it } from 'vitest';
import { cronFromText, generateCronFromText } from '../../../src/tools/cron-from-text/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const ctx = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'cron-source4',
  onProgress: () => {},
});

async function publicJson(description: string): Promise<unknown> {
  const result = await cronFromText.run([], { description }, ctx());
  const blob = Array.isArray(result) ? result[0] : result;
  expect(blob).toBeInstanceOf(Blob);
  if (!blob) throw new Error('Missing real cron JSON artifact.');
  expect(blob.type).toBe('application/json');
  return JSON.parse(await blob.text()) as unknown;
}

const refused = [
  'every day and every Monday',
  'every day and on Monday',
  'every week on Monday and every Friday',
  'every week on Monday and',
  'every week on Monday,',
  'every week on Monday and and Friday',
  'every week on Monday on Friday',
  'every week on Monday and on Friday',
  'every week and on Monday',
  'every week on Monday every Friday',
  'every week Monday',
  'Monday every week',
  'every Monday every 5 minutes',
  'every 5 minutes every Monday',
  'every weekday every hour',
  'every hour every weekday',
] as const;

const accepted = [
  ['every week on Monday', '0 0 * * 1', 'every week, on Monday'],
  ['on Monday every week', '0 0 * * 1', 'every week, on Monday'],
  ['every day on Monday', '0 0 * * 1', 'every day, on Monday'],
  ['on Monday every day', '0 0 * * 1', 'every day, on Monday'],
  ['every week on Monday at 9am', '0 9 * * 1', 'every week, at 9:00 AM, on Monday'],
  ['on Monday every week at 9am', '0 9 * * 1', 'every week, at 9:00 AM, on Monday'],
  ['at 9am every week on Monday', '0 9 * * 1', 'every week, at 9:00 AM, on Monday'],
  ['every week on Monday 9am', '0 9 * * 1', 'every week, at 9:00 AM, on Monday'],
  ['every week, on Monday', '0 0 * * 1', 'every week, on Monday'],
  ['on Monday, every week', '0 0 * * 1', 'every week, on Monday'],
  ['every week on Monday, and Friday', '0 0 * * 1,5', 'every week, on Monday, Friday'],
  ['every week on weekdays', '0 0 * * 1,2,3,4,5', 'every week, on weekdays'],
  ['every week on weekends', '0 0 * * 0,6', 'every week, on weekends'],
  ['every week', '0 0 * * 0', 'every week (Sunday)'],
  ['every Monday and Friday at 9am', '0 9 * * 1,5', 'at 9:00 AM, on Monday, Friday'],
] as const;

describe('cron SOURCE4 complete constraint ownership and actual public JSON', () => {
  it.each(refused)('refuses independent or malformed restrictions: %s', async (description) => {
    const expected = {
      description,
      cron: '',
      confidence: 'no-match',
      matchedTokens: [],
      fields: { minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '' },
    };
    expect.soft(generateCronFromText(description)).toMatchObject(expected);
    expect(await publicJson(description)).toMatchObject(expected);
  });
  it.each(accepted)(
    'preserves an unambiguous schedule and explanation: %s',
    async (description, cron, explanation) => {
      const expected = { description, cron, explanation };
      expect.soft(generateCronFromText(description)).toMatchObject(expected);
      expect(await publicJson(description)).toMatchObject(expected);
    },
  );
});
