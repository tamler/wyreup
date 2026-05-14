import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CronParserParams {
  nextCount?: number;
  timezone?: string;
}

export interface CronParserResult {
  valid: boolean;
  error?: string;
  expression: string;
  description: string;
  nextRuns: string[];
  fields: {
    minute: number[];
    hour: number[];
    dayOfMonth: number[];
    month: number[];
    dayOfWeek: number[];
  };
}

export const defaultCronParserParams: CronParserParams = {
  nextCount: 5,
};

export const cronParser: ToolModule<CronParserParams> = {
  id: 'cron-parser',
  slug: 'cron-parser',
  name: 'Cron Parser',
  description:
    'Parse a cron expression and show the next scheduled run times. Validates syntax and lists field values.',
  category: 'dev',
  keywords: ['cron', 'schedule', 'expression', 'interval', 'job', 'parse', 'time'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCronParserParams,

  paramSchema: {
    nextCount: {
      type: 'number',
      label: 'Upcoming runs to show',
      min: 1,
      max: 50,
      step: 1,
    },
    timezone: {
      type: 'string',
      label: 'Timezone',
      placeholder: 'UTC, America/New_York, Europe/Berlin…',
      help: 'IANA timezone name. Leave empty for UTC.',
    },
  },

  async run(
    inputs: File[],
    params: CronParserParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading cron parser' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const { parseExpression } = await import('cron-parser');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing cron expression' });

    const expression = (await inputs[0]!.text()).trim();
    const nextCount = Math.min(params.nextCount ?? 5, 50);

    let result: CronParserResult;
    try {
      const opts: Record<string, unknown> = {};
      if (params.timezone) opts['tz'] = params.timezone;

      const interval = parseExpression(expression, opts);
      const nextRuns: string[] = [];
      for (let i = 0; i < nextCount; i++) {
        nextRuns.push(interval.next().toISOString());
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields = interval.fields as any as Record<string, readonly number[]>;

      result = {
        valid: true,
        expression,
        description: 'Custom cron expression',
        nextRuns,
        fields: {
          minute: [...(fields['minute'] ?? [])],
          hour: [...(fields['hour'] ?? [])],
          dayOfMonth: [...(fields['dayOfMonth'] ?? [])],
          month: [...(fields['month'] ?? [])],
          dayOfWeek: [...(fields['dayOfWeek'] ?? [])],
        },
      };
    } catch (e) {
      result = {
        valid: false,
        error: (e as Error).message,
        expression,
        description: 'Invalid expression',
        nextRuns: [],
        fields: {
          minute: [],
          hour: [],
          dayOfMonth: [],
          month: [],
          dayOfWeek: [],
        },
      };
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
