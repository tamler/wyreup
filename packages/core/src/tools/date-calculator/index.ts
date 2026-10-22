import type { ToolModule, ToolRunContext } from '../../types.js';
import type { DateCalculatorParams, DateUnit } from './types.js';
import type { Temporal } from '@js-temporal/polyfill';
import { cloneUtilityJson } from '../../utilities/common.js';

export type { DateCalculatorParams, DateCalcMode, DateUnit } from './types.js';
export { defaultDateCalculatorParams } from './types.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDate(s: string, temporal: typeof Temporal): Temporal.PlainDate | null {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return null;
  try {
    const d = temporal.PlainDate.from(s, { overflow: 'reject' });
    return d.year >= 1900 && d.year <= 2100 ? d : null;
  } catch {
    return null;
  }
}

function diffDays(a: Temporal.PlainDate, b: Temporal.PlainDate): number {
  return a.until(b, { largestUnit: 'days' }).days;
}

function addToDate(
  d: Temporal.PlainDate,
  amount: number,
  unit: DateUnit,
  overflow: 'constrain' | 'reject',
): Temporal.PlainDate {
  const limits = { days: 73050, weeks: 10435, months: 2400, years: 200 };
  if (!Object.hasOwn(limits, unit) || !Number.isInteger(amount) || Math.abs(amount) > limits[unit])
    throw new Error('Use a bounded whole-number calendar amount and supported unit.');
  const result = d.add({ [unit]: amount }, { overflow });
  if (result.year < 1900 || result.year > 2100)
    throw new Error('Result date must be between 1900 and 2100.');
  return result;
}

export const dateCalculator: ToolModule<DateCalculatorParams> = {
  id: 'date-calculator',
  slug: 'date-calculator',
  name: 'Date Calculator',
  description:
    'Calculate the difference between two dates, add/subtract time from a date, or find the day of the week.',
  category: 'create',
  keywords: ['date', 'calculator', 'difference', 'days', 'weeks', 'months', 'years', 'calendar'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    mode: 'diff',
    date1: '2026-01-01',
    date2: '2026-12-31',
    amount: 30,
    unit: 'days',
    weekend: [6, 7],
    holidays: [],
    overflow: 'constrain',
  },

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
    weekend: {
      type: 'array',
      itemType: 'number',
      label: 'Weekend ISO weekdays',
      help: 'Monday is 1; Sunday is 7. Empty means no weekends.',
      showWhen: { field: 'mode', equals: 'diff' },
    },
    holidays: {
      type: 'array',
      itemType: 'string',
      label: 'Holiday dates',
      help: 'Unique YYYY-MM-DD dates; holidays on weekends are not deducted twice.',
      showWhen: { field: 'mode', equals: 'diff' },
    },
    overflow: {
      type: 'enum',
      label: 'Month-end behavior',
      options: [
        { value: 'constrain', label: 'Constrain to last valid day' },
        { value: 'reject', label: 'Reject an invalid day' },
      ],
      showWhen: { field: 'mode', equals: 'add' },
    },
  },

  async run(_inputs: File[], params: DateCalculatorParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new DOMException('Date calculation cancelled.', 'AbortError');
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Calculating date' });

    let result: Record<string, unknown>;

    try {
      const { Temporal } = await import('@js-temporal/polyfill');
      if (ctx.signal.aborted) throw new DOMException('Date calculation cancelled.', 'AbortError');
      params = cloneUtilityJson(params) as unknown as DateCalculatorParams;
      if (
        !params ||
        typeof params !== 'object' ||
        Array.isArray(params) ||
        Object.keys(params).some(
          (key) =>
            ![
              'mode',
              'date1',
              'date2',
              'amount',
              'unit',
              'weekend',
              'holidays',
              'overflow',
            ].includes(key),
        )
      )
        throw new Error('Unknown or invalid date parameters.');
      const { mode, date1, date2, amount, unit } = params;
      const weekend = params.weekend ?? [6, 7],
        holidays = params.holidays ?? [],
        overflow = params.overflow ?? 'constrain';
      if (
        !Array.isArray(weekend) ||
        weekend.length > 7 ||
        new Set(weekend).size !== weekend.length ||
        weekend.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
      )
        throw new Error('Weekend weekdays must be unique ISO numbers from 1 to 7.');
      if (
        !Array.isArray(holidays) ||
        holidays.length > 366 ||
        new Set(holidays).size !== holidays.length ||
        holidays.some((day) => !parseDate(day, Temporal))
      )
        throw new Error('Use at most 366 unique valid holiday dates.');
      if (overflow !== 'constrain' && overflow !== 'reject')
        throw new Error('Choose constrain or reject for calendar overflow.');

      if (mode === 'diff') {
        if (!date1) throw new Error('"date1" is required for diff mode');
        if (!date2) throw new Error('"date2" is required for diff mode');
        const d1 = parseDate(date1, Temporal);
        const d2 = parseDate(date2, Temporal);
        if (!d1) throw new Error(`Invalid date format for date1: "${date1}". Use YYYY-MM-DD.`);
        if (!d2) throw new Error(`Invalid date format for date2: "${date2}". Use YYYY-MM-DD.`);
        const days = diffDays(d1, d2);
        const distance = d1.until(d2, { largestUnit: 'years' });
        const breakdown = { years: distance.years, months: distance.months, days: distance.days };
        const earlier = days < 0 ? d2 : d1,
          later = days < 0 ? d1 : d2;
        const excluded = new Set(holidays);
        let businessDays = 0;
        for (
          let day = earlier, count = 0;
          Temporal.PlainDate.compare(day, later) < 0;
          day = day.add({ days: 1 }), count++
        ) {
          if (count % 1024 === 0 && ctx.signal.aborted)
            throw new DOMException('Date calculation cancelled.', 'AbortError');
          if (!weekend.includes(day.dayOfWeek) && !excluded.has(day.toString())) businessDays++;
        }
        businessDays *= days < 0 ? -1 : 1;
        result = {
          valid: true,
          mode,
          date1,
          date2,
          totalDays: days,
          totalWeeks: days / 7,
          totalHours: days * 24,
          businessDays,
          assumptions: {
            weekend,
            holidays,
            range: 'Half-open [earlier, later); date-only hours use 24 hours per day.',
          },
          breakdown,
          formatted: `${Math.abs(days)} days (${breakdown.years}y ${breakdown.months}mo ${breakdown.days}d)`,
        };
      } else if (mode === 'add') {
        if (!date1) throw new Error('"date1" is required for add mode');
        if (amount === undefined) throw new Error('"amount" is required for add mode');
        if (!unit) throw new Error('"unit" is required for add mode');
        const d1 = parseDate(date1, Temporal);
        if (!d1) throw new Error(`Invalid date format for date1: "${date1}". Use YYYY-MM-DD.`);
        const resultDate = addToDate(d1, amount, unit, overflow);
        result = {
          valid: true,
          mode,
          date1,
          amount,
          unit,
          result: resultDate.toString(),
          overflow,
          formatted: `${date1} + ${amount} ${unit} = ${resultDate.toString()}`,
        };
      } else if (mode === 'day-of-week') {
        if (!date1) throw new Error('"date1" is required for day-of-week mode');
        const d1 = parseDate(date1, Temporal);
        if (!d1) throw new Error(`Invalid date format for date1: "${date1}". Use YYYY-MM-DD.`);
        const dayIndex = d1.dayOfWeek % 7;
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
      if (ctx.signal.aborted) throw new DOMException('Date calculation cancelled.', 'AbortError');
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
