import type { ToolModule, ToolRunContext } from '../../types.js';
import type { DateCalculatorParams, DateUnit } from './types.js';

export type { DateCalculatorParams, DateCalcMode, DateUnit } from './types.js';
export { defaultDateCalculatorParams } from './types.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDate(s: string): Date | null {
  if (!ISO_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function addToDate(d: Date, amount: number, unit: DateUnit): Date {
  // Work on a plain object to avoid timezone drift
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();   // 0-indexed
  const day = d.getUTCDate();

  switch (unit) {
    case 'days': return new Date(Date.UTC(y, m, day + amount));
    case 'weeks': return new Date(Date.UTC(y, m, day + amount * 7));
    case 'months': return new Date(Date.UTC(y, m + amount, day));
    case 'years': return new Date(Date.UTC(y + amount, m, day));
    default: throw new Error(`Unknown unit: ${String(unit)}`);
  }
}

function isoFormat(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function breakdownDiff(days: number): { years: number; months: number; days: number } {
  const absDays = Math.abs(days);
  const years = Math.floor(absDays / 365);
  const rem = absDays - years * 365;
  const months = Math.floor(rem / 30);
  const remDays = rem - months * 30;
  return { years, months, days: remDays };
}

export const dateCalculator: ToolModule<DateCalculatorParams> = {
  id: 'date-calculator',
  slug: 'date-calculator',
  name: 'Date Calculator',
  description: 'Calculate the difference between two dates, add/subtract time from a date, or find the day of the week.',
  category: 'create',
  keywords: ['date', 'calculator', 'difference', 'days', 'weeks', 'months', 'years', 'calendar'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { mode: 'diff', date1: '2026-01-01', date2: '2026-12-31', amount: 30, unit: 'days' },

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'diff', label: 'difference between two dates' },
        { value: 'add', label: 'add/subtract from a date' },
        { value: 'day-of-week', label: 'day of week for a date' },
      ],
    },
    date1: {
      type: 'string',
      label: 'date',
      placeholder: 'YYYY-MM-DD',
      help: 'Starting date in ISO 8601 format.',
    },
    date2: {
      type: 'string',
      label: 'second date',
      placeholder: 'YYYY-MM-DD',
      showWhen: { field: 'mode', equals: 'diff' },
    },
    amount: {
      type: 'number',
      label: 'amount',
      help: 'Negative numbers subtract.',
      showWhen: { field: 'mode', equals: 'add' },
    },
    unit: {
      type: 'enum',
      label: 'unit',
      options: [
        { value: 'days', label: 'days' },
        { value: 'weeks', label: 'weeks' },
        { value: 'months', label: 'months' },
        { value: 'years', label: 'years' },
      ],
      showWhen: { field: 'mode', equals: 'add' },
    },
  },

   
  async run(
    _inputs: File[],
    params: DateCalculatorParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Calculating date' });

    let result: Record<string, unknown>;

    try {
      const { mode, date1, date2, amount, unit } = params;

      if (mode === 'diff') {
        if (!date1) throw new Error('"date1" is required for diff mode');
        if (!date2) throw new Error('"date2" is required for diff mode');
        const d1 = parseDate(date1);
        const d2 = parseDate(date2);
        if (!d1) throw new Error(`Invalid date format for date1: "${date1}". Use YYYY-MM-DD.`);
        if (!d2) throw new Error(`Invalid date format for date2: "${date2}". Use YYYY-MM-DD.`);
        const days = diffDays(d1, d2);
        const breakdown = breakdownDiff(days);
        result = {
          valid: true,
          mode,
          date1,
          date2,
          totalDays: days,
          breakdown,
          formatted: `${Math.abs(days)} days (${breakdown.years}y ${breakdown.months}mo ${breakdown.days}d)`,
        };
      } else if (mode === 'add') {
        if (!date1) throw new Error('"date1" is required for add mode');
        if (amount === undefined) throw new Error('"amount" is required for add mode');
        if (!unit) throw new Error('"unit" is required for add mode');
        const d1 = parseDate(date1);
        if (!d1) throw new Error(`Invalid date format for date1: "${date1}". Use YYYY-MM-DD.`);
        const resultDate = addToDate(d1, amount, unit);
        result = {
          valid: true,
          mode,
          date1,
          amount,
          unit,
          result: isoFormat(resultDate),
          formatted: `${date1} + ${amount} ${unit} = ${isoFormat(resultDate)}`,
        };
      } else if (mode === 'day-of-week') {
        if (!date1) throw new Error('"date1" is required for day-of-week mode');
        const d1 = parseDate(date1);
        if (!d1) throw new Error(`Invalid date format for date1: "${date1}". Use YYYY-MM-DD.`);
        const dayIndex = d1.getUTCDay();
        result = {
          valid: true,
          mode,
          date1,
          dayIndex,
          dayName: DAY_NAMES[dayIndex],
          formatted: `${date1} is a ${DAY_NAMES[dayIndex] ?? 'Unknown'}`,
        };
      } else {
        throw new Error(`Unknown mode: ${String(mode)}`);
      }
    } catch (err) {
      result = { valid: false, error: err instanceof Error ? err.message : String(err) };
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
