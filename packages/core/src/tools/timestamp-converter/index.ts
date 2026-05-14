import type { ToolModule, ToolRunContext } from '../../types.js';
import type { TimestampConverterParams, TimestampConverterResult } from './types.js';

export type { TimestampConverterParams, TimestampConverterResult } from './types.js';
export { defaultTimestampConverterParams } from './types.js';

function relativeTime(ms: number): string {
  const now = Date.now();
  const diffMs = ms - now;
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  const months = Math.floor(abs / (86400000 * 30));
  const years = Math.floor(abs / (86400000 * 365));

  let label: string;
  if (seconds < 60) label = `${seconds} second${seconds !== 1 ? 's' : ''}`;
  else if (minutes < 60) label = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? 's' : ''}`;
  else if (days < 30) label = `${days} day${days !== 1 ? 's' : ''}`;
  else if (months < 12) label = `${months} month${months !== 1 ? 's' : ''}`;
  else label = `${years} year${years !== 1 ? 's' : ''}`;

  return past ? `${label} ago` : `in ${label}`;
}

function parseTimestamp(input: string): Date | null {
  const trimmed = input.trim();

  // Try numeric
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') {
    // epoch seconds if < 10^10, epoch ms if >= 10^10
    const ms = num < 1e10 ? num * 1000 : num;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }

  // Try ISO 8601 and general date strings
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  return null;
}

export const timestampConverter: ToolModule<TimestampConverterParams> = {
  id: 'timestamp-converter',
  slug: 'timestamp-converter',
  name: 'Timestamp Converter',
  description: 'Convert epoch seconds, epoch milliseconds, or ISO 8601 timestamps to all common representations.',
  category: 'inspect',
  keywords: ['timestamp', 'epoch', 'unix', 'date', 'time', 'convert', 'iso8601'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  async run(
    inputs: File[],
    _params: TimestampConverterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Parsing timestamp' });

    const input = await inputs[0]!.text();
    const date = parseTimestamp(input.trim());

    let result: TimestampConverterResult;

    if (!date) {
      result = {
        input: input.trim(),
        valid: false,
        epochSeconds: null,
        epochMilliseconds: null,
        iso8601: null,
        utc: null,
        local: null,
        relative: null,
      };
    } else {
      const ms = date.getTime();
      result = {
        input: input.trim(),
        valid: true,
        epochSeconds: Math.floor(ms / 1000),
        epochMilliseconds: ms,
        iso8601: date.toISOString(),
        utc: date.toUTCString(),
        local: new Intl.DateTimeFormat('en-US', {
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(date),
        relative: relativeTime(ms),
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
