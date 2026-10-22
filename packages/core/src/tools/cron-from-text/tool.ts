import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CronFromTextParams {
  mode?: 'text' | 'fields';
  minute?: string;
  hour?: string;
  dayOfMonth?: string;
  month?: string;
  dayOfWeek?: string;
  timezone?: string;
  currentDate?: string;
  nextCount?: number;
  /** Natural-language schedule description. Required. */
  description?: string;
}

export const defaultCronFromTextParams: CronFromTextParams = {
  mode: 'text',
  minute: '*',
  hour: '*',
  dayOfMonth: '*',
  month: '*',
  dayOfWeek: '*',
  timezone: 'UTC',
  currentDate: '',
  nextCount: 5,
  description: '',
};

function validateField(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || !value || value.length > 128)
    throw new Error(`Invalid ${label} field`);
  for (const part of value.split(',')) {
    const match = /^(\*|[0-9]+(?:-[0-9]+)?)(?:\/([0-9]+))?$/.exec(part);
    if (!match) throw new Error(`Invalid ${label} field`);
    if (match[1] !== '*') {
      const values = match[1]!.split('-').map(Number);
      if (
        values.some((v) => !Number.isSafeInteger(v) || v < min || v > max) ||
        (values.length === 2 && values[0]! > values[1]!)
      )
        throw new Error(`Invalid ${label} bounds`);
    }
    if (match[2] !== undefined) {
      const step = Number(match[2]);
      if (!Number.isSafeInteger(step) || step < 1 || step > max - min + 1)
        throw new Error(`Invalid ${label} step`);
    }
  }
  return value;
}

function validateAnchor(value: unknown): string {
  if (typeof value !== 'string') throw new Error('currentDate must be an explicit ISO instant');
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) throw new Error('currentDate must be an explicit ISO instant');
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[8]!;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]! ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Invalid currentDate ISO instant');
  return value;
}

export const cronFromText: ToolModule<CronFromTextParams> = {
  id: 'cron-from-text',
  slug: 'cron-from-text',
  name: 'Cron From Text',
  description:
    'Generate cron from a limited set of complete schedule phrases or five structured fields. Unknown constraints return no-match. Preview future runs from an explicit date and IANA timezone; scheduler dialects differ.',
  llmDescription:
    'Convert a plain-English schedule like "every weekday at 9am" or "every 5 minutes" into a 5-field cron expression (minute hour day-of-month month day-of-week). Returns JSON with cron, explanation, fields breakdown, and confidence. For unparseable phrasings, returns confidence: "no-match" — call the AI variant or revise.',
  category: 'inspect',
  keywords: ['cron', 'schedule', 'crontab', 'natural language', 'from text', 'generate'],

  input: {
    accept: ['text/plain'],
    min: 0,
    max: 1,
    sizeLimit: 4 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCronFromTextParams,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'Mode',
      options: [
        { value: 'text', label: 'Natural language' },
        { value: 'fields', label: 'Five fields and next runs' },
      ],
    },
    minute: {
      type: 'string',
      label: 'Minute (0–59)',
      maxLength: 128,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    hour: {
      type: 'string',
      label: 'Hour (0–23)',
      maxLength: 128,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    dayOfMonth: {
      type: 'string',
      label: 'Day of month (1–31)',
      maxLength: 128,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    month: {
      type: 'string',
      label: 'Month (1–12)',
      maxLength: 128,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    dayOfWeek: {
      type: 'string',
      label: 'Day of week (0–7; Sunday 0 or 7)',
      maxLength: 128,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    timezone: {
      type: 'string',
      label: 'IANA timezone',
      maxLength: 128,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    currentDate: {
      type: 'string',
      label: 'Start instant (ISO with Z or offset)',
      maxLength: 64,
      help: 'Required. No implicit current time. Restricted day-of-month and day-of-week fields use OR semantics.',
      showWhen: { field: 'mode', equals: 'fields' },
    },
    nextCount: {
      type: 'number',
      label: 'Next runs',
      min: 1,
      max: 50,
      step: 1,
      showWhen: { field: 'mode', equals: 'fields' },
    },
    description: {
      type: 'string',
      label: 'description',
      help: 'Use every N minutes/hours/days, every week/month, one time, weekday names or a day of the month. Combining an interval and weekday restriction requires explicit on, such as every week on Monday; independent clauses are refused. Unsupported words and constraints return no-match; daily, weekly, each day, ranges, exceptions and nth weekdays require structured fields. A bare day restriction means every minute on that day. Calendar steps reset at field boundaries.',
      placeholder: 'every weekday at 9am',
      multiline: true,
      showWhen: { field: 'mode', equals: 'text' },
    },
  },

  async run(inputs: File[], params: CronFromTextParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');
    if (params.mode !== undefined && params.mode !== 'text' && params.mode !== 'fields')
      throw new Error('Invalid cron mode');
    if (params.mode === 'fields') {
      if (inputs.length) throw new Error('Structured fields mode does not accept files');
      const fields = {
        minute: validateField(params.minute ?? '*', 'minute', 0, 59),
        hour: validateField(params.hour ?? '*', 'hour', 0, 23),
        dayOfMonth: validateField(params.dayOfMonth ?? '*', 'day of month', 1, 31),
        month: validateField(params.month ?? '*', 'month', 1, 12),
        dayOfWeek: validateField(params.dayOfWeek ?? '*', 'day of week', 0, 7),
      };
      const currentDate = validateAnchor(params.currentDate);
      const timezone = params.timezone ?? 'UTC';
      if (
        typeof timezone !== 'string' ||
        !timezone ||
        timezone.length > 128 ||
        /^[+-]/.test(timezone)
      )
        throw new Error('Invalid IANA timezone');
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
      } catch {
        throw new Error('Invalid IANA timezone');
      }
      const nextCount = params.nextCount ?? 5;
      if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 50)
        throw new Error('nextCount must be an integer from 1 to 50');
      const cron = Object.values(fields).join(' ');
      ctx.onProgress({ stage: 'processing', percent: 50, message: 'Previewing schedule' });
      const { CronExpressionParser } = await import('cron-parser');
      if (ctx.signal.aborted) throw new Error('Aborted');
      const expression = CronExpressionParser.parse(cron, {
        currentDate,
        tz: timezone,
        strict: false,
      });
      const nextRuns: string[] = [];
      for (let i = 0; i < nextCount; i++) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        nextRuns.push(expression.next().toISOString()!);
      }
      const result = {
        cron,
        fields,
        timezone,
        currentDate,
        nextRuns,
        dayMatching: 'OR when both day-of-month and day-of-week are restricted',
        warning:
          'Preview uses cron-parser five-field semantics. Verify the target scheduler dialect and timezone; this tool does not execute schedules.',
      };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    }
    if (inputs.length > 1 || inputs.some((file) => file.size > 4096))
      throw new Error('Text mode accepts at most one 4 KiB file');
    let description = params.description ?? '';
    if (typeof description !== 'string' || new TextEncoder().encode(description).length > 4096)
      throw new Error('Description must be text within 4 KiB');
    if (!description.trim() && inputs.length === 1) {
      const bytes = await inputs[0]!.slice(0, 4097).arrayBuffer();
      if (ctx.signal.aborted) throw new Error('Aborted');
      if (bytes.byteLength > 4096) throw new Error('Description exceeds 4096 bytes');
      description = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing schedule' });
    if (ctx.signal.aborted) throw new Error('Aborted');
    const { generateCronFromText } = await import('./generate.js');
    if (ctx.signal.aborted) throw new Error('Aborted');
    const result = generateCronFromText(description);
    if (ctx.signal.aborted) throw new Error('Aborted');
    const output =
      result.fields.dayOfMonth === 'L'
        ? {
            ...result,
            warning: [
              result.warning,
              'L is a non-POSIX extension. Verify support in the target scheduler.',
            ]
              .filter(Boolean)
              .join(' '),
          }
        : result;
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })];
  },

  seoContent: {
    intro:
      'Describe a schedule in plain English or enter five numeric cron fields. Preview future runs using an explicit start instant and IANA timezone. The heuristic engine parses intervals, times, days of the week, and days of the month locally. Scheduler dialects differ: verify the expression and timezone in the system where it will run.',
    useCases: [
      'Translate a schedule from a meeting note ("run every weekday at 9am") into a cron line.',
      'Bootstrap a GitHub Actions workflow `on.schedule.cron` value without reaching for a cheat sheet.',
      'Sanity-check a complicated schedule by translating it back from English.',
      'Generate the cron for a Wyreup trigger rule so it fires on the cadence you describe.',
    ],
    faq: [
      {
        q: 'What syntax does the output use?',
        a: 'Five fields: minute, hour, day-of-month, month, day-of-week. Structured mode accepts numeric lists, ranges, steps and wildcards, with 0 or 7 for Sunday. Restricted day-of-month and day-of-week fields use OR in the preview. Target schedulers may use different fields, day matching or timezones.',
      },
      {
        q: 'Does it support "every weekday" and "weekends"?',
        a: 'Yes. "Weekdays" maps to `1,2,3,4,5`; "weekends" to `0,6`. You can also list specific days like "every Monday and Friday at 6pm".',
      },
      {
        q: 'Can I generate cron for "last day of the month"?',
        a: 'Natural-language mode emits the `L` extension for "last day of the month" and warns that it is non-POSIX. Verify target scheduler support. Structured mode intentionally rejects `L`, `?` and `#`.',
      },
      {
        q: 'What if my schedule is unusual?',
        a: 'For phrasings the heuristic can\'t parse the result returns `confidence: "no-match"` plus an `upgrade` field. The hosted-AI Pro tier will handle arbitrary phrasings; meanwhile, simplify or split the schedule.',
      },
    ],
    alsoTry: [
      {
        id: 'cron-parser',
        why: 'Verify the cron expression by parsing it back into a schedule description.',
      },
      {
        id: 'timestamp-converter',
        why: 'Convert between unix timestamps, ISO dates, and human-readable formats.',
      },
    ],
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
