import { describe, it, expect } from 'vitest';
import { generateCronFromText, cronFromText } from '../../../src/tools/cron-from-text/index.js';

describe('cron-from-text — metadata', () => {
  it('has id cron-from-text', () => {
    expect(cronFromText.id).toBe('cron-from-text');
  });
  it('is in the inspect category', () => {
    expect(cronFromText.category).toBe('inspect');
  });
  it('outputs application/json', () => {
    expect(cronFromText.output.mime).toBe('application/json');
  });
  it('declares free cost', () => {
    expect(cronFromText.cost).toBe('free');
  });
});

describe('generateCronFromText — common schedules', () => {
  it('every 5 minutes', () => {
    const r = generateCronFromText('every 5 minutes');
    expect(r.cron).toBe('*/5 * * * *');
  });

  it('every minute', () => {
    const r = generateCronFromText('every minute');
    expect(r.cron).toBe('* * * * *');
  });

  it('every hour', () => {
    const r = generateCronFromText('every hour');
    expect(r.cron).toBe('0 * * * *');
  });

  it('every 2 hours', () => {
    const r = generateCronFromText('every 2 hours');
    expect(r.cron).toBe('0 */2 * * *');
  });

  it('daily at midnight', () => {
    const r = generateCronFromText('every day at midnight');
    expect(r.cron).toBe('0 0 * * *');
  });

  it('daily at noon', () => {
    const r = generateCronFromText('every day at noon');
    expect(r.cron).toBe('0 12 * * *');
  });

  it('at 9am', () => {
    const r = generateCronFromText('every day at 9am');
    expect(r.cron).toBe('0 9 * * *');
  });

  it('at 9:30 pm', () => {
    const r = generateCronFromText('every day at 9:30 pm');
    expect(r.cron).toBe('30 21 * * *');
  });

  it('every Monday at 9am', () => {
    const r = generateCronFromText('every Monday at 9am');
    expect(r.cron).toBe('0 9 * * 1');
  });

  it('weekdays at 8:30am', () => {
    const r = generateCronFromText('weekdays at 8:30am');
    expect(r.cron).toBe('30 8 * * 1,2,3,4,5');
  });

  it('weekends at noon', () => {
    const r = generateCronFromText('weekends at noon');
    expect(r.cron).toBe('0 12 * * 0,6');
  });

  it('first of the month at midnight', () => {
    const r = generateCronFromText('first of the month at midnight');
    expect(r.cron).toBe('0 0 1 * *');
  });

  it('last day of the month', () => {
    const r = generateCronFromText('last day of the month at midnight');
    expect(r.cron).toBe('0 0 L * *');
  });

  it('Monday and Friday at 6pm', () => {
    const r = generateCronFromText('every Monday and Friday at 6pm');
    expect(r.cron).toBe('0 18 * * 1,5');
  });
});

describe('generateCronFromText — output shape', () => {
  it('exposes the 5 fields', () => {
    const r = generateCronFromText('every Monday at 9am');
    expect(r.fields.minute).toBe('0');
    expect(r.fields.hour).toBe('9');
    expect(r.fields.dayOfWeek).toBe('1');
  });

  it('provides a human-readable explanation', () => {
    const r = generateCronFromText('weekdays at 8:30am');
    expect(r.explanation).toMatch(/weekdays/);
    expect(r.explanation).toMatch(/8:30/);
  });

  it('lists matched tokens', () => {
    const r = generateCronFromText('every Monday at 9am');
    expect(r.matchedTokens.length).toBeGreaterThan(0);
  });

  it('high confidence for time + day combination', () => {
    const r = generateCronFromText('every Monday at 9am');
    expect(r.confidence).toBe('high');
  });

  it('medium confidence for interval-only', () => {
    const r = generateCronFromText('every 10 minutes');
    expect(r.confidence).toBe('medium');
  });
});

describe('generateCronFromText — no-match path', () => {
  it('returns no-match for irrelevant text', () => {
    const r = generateCronFromText('the moon orbits the earth');
    expect(r.confidence).toBe('no-match');
    expect(r.cron).toBe('');
    expect(r.upgrade).toMatch(/Pro/);
  });

  it('throws on empty description', () => {
    expect(() => generateCronFromText('')).toThrow();
    expect(() => generateCronFromText('   ')).toThrow();
  });
});

describe('generateCronFromText — generated cron is well-formed', () => {
  const inputs = [
    'every minute',
    'every 15 minutes',
    'every hour',
    'every 6 hours',
    'every day at midnight',
    'every day at noon',
    'every day at 9am',
    'every Monday at 9am',
    'weekdays at 8:30am',
    'weekends at 10pm',
    'first of the month at midnight',
    'last day of the month at midnight',
  ];
  for (const desc of inputs) {
    it(`produces 5 space-separated fields for: "${desc}"`, () => {
      const r = generateCronFromText(desc);
      expect(r.cron.split(' ')).toHaveLength(5);
    });
  }
});
