import { describe, expect, it } from 'vitest';
import { generateCronFromText } from '../../../src/tools/cron-from-text/index.js';

describe('cron correction 3 — one complete interval phrase', () => {
  it.each([
    'every minute and every 2 minutes',
    'every hour and every 2 hours',
    'every day and every week',
    'every week and every month',
  ])('refuses contradictory interval phrases: %s', (description) => {
    expect(generateCronFromText(description)).toMatchObject({
      cron: '',
      confidence: 'no-match',
      matchedTokens: [],
      fields: { minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '' },
    });
  });
});
