import type { ToolModule, ToolRunContext } from '../../types.js';
import {
  defaultIcsToCsvParams,
  type IcsEventRow,
  type IcsToCsvParams,
} from './types.js';

export type { IcsEventRow, IcsToCsvFormat, IcsToCsvParams } from './types.js';
export { defaultIcsToCsvParams } from './types.js';

const CSV_COLUMNS: ReadonlyArray<keyof IcsEventRow> = [
  'start',
  'end',
  'summary',
  'location',
  'description',
  'status',
  'all_day',
  'rrule',
  'uid',
];

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfoldLines(text: string): string[] {
  const physicalLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];

  for (const line of physicalLines) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;

  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted;
    if (!quoted && value[index] === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseProperty(line: string): IcsProperty | null {
  let separator = -1;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && line[index] === ':') {
      separator = index;
      break;
    }
  }
  if (separator < 0) return null;

  const declaration = splitOutsideQuotes(line.slice(0, separator), ';');
  const name = declaration.shift()?.toUpperCase() ?? '';
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const entry of declaration) {
    const equals = entry.indexOf('=');
    if (equals < 1) continue;
    const key = entry.slice(0, equals).toUpperCase();
    const rawValue = entry.slice(equals + 1);
    params[key] = rawValue.replace(/^"|"$/g, '');
  }

  return { name, params, value: line.slice(separator + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, escaped: string) => {
    if (escaped === 'n' || escaped === 'N') return '\n';
    return escaped;
  });
}

function twoDigits(value: string): string | null {
  return /^\d{2}$/.test(value) ? value : null;
}

function bestEffortIso(raw: string, isDate: boolean): string | null {
  if (isDate) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!match) return null;
  const month = twoDigits(match[2]!);
  const day = twoDigits(match[3]!);
  const hour = twoDigits(match[4]!);
  const minute = twoDigits(match[5]!);
  const second = twoDigits(match[6]!);
  if (!month || !day || !hour || !minute || !second) return null;
  return `${match[1]}-${month}-${day}T${hour}:${minute}:${second}${match[7] ? 'Z' : ''}`;
}

function formatDate(property: IcsProperty | undefined): string {
  if (!property) return '';
  const isDate = property.params['VALUE']?.toUpperCase() === 'DATE' || /^\d{8}$/.test(property.value);
  const iso = bestEffortIso(property.value, isDate);
  const timezone = property.params['TZID'];
  const details = [iso, timezone ? `TZID=${timezone}` : ''].filter(Boolean).join('; ');
  return details ? `${property.value} (${details})` : property.value;
}

function parseEvents(text: string): IcsEventRow[] {
  const events: IcsEventRow[] = [];
  let properties: Map<string, IcsProperty> | null = null;
  let nestedDepth = 0;

  for (const line of unfoldLines(text)) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      properties = new Map();
      nestedDepth = 0;
      continue;
    }
    if (!properties) continue;
    if (upper.startsWith('BEGIN:')) {
      nestedDepth++;
      continue;
    }
    if (upper === 'END:VEVENT') {
      const start = properties.get('DTSTART');
      const isAllDay =
        start?.params['VALUE']?.toUpperCase() === 'DATE' || /^\d{8}$/.test(start?.value ?? '');
      events.push({
        start: formatDate(start),
        end: formatDate(properties.get('DTEND')),
        summary: unescapeText(properties.get('SUMMARY')?.value ?? ''),
        location: unescapeText(properties.get('LOCATION')?.value ?? ''),
        description: unescapeText(properties.get('DESCRIPTION')?.value ?? ''),
        status: properties.get('STATUS')?.value ?? '',
        all_day: isAllDay,
        rrule: properties.get('RRULE')?.value ?? '',
        uid: unescapeText(properties.get('UID')?.value ?? ''),
      });
      properties = null;
      continue;
    }
    if (upper.startsWith('END:')) {
      nestedDepth = Math.max(0, nestedDepth - 1);
      continue;
    }
    if (nestedDepth > 0) continue;

    const property = parseProperty(line);
    if (property && !properties.has(property.name)) properties.set(property.name, property);
  }

  return events;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function eventsToCsv(events: IcsEventRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = events.map((event) =>
    CSV_COLUMNS.map((column) => escapeCsv(String(event[column]))).join(','),
  );
  return [header, ...rows].join('\r\n');
}

export const icsToCsv: ToolModule<IcsToCsvParams> = {
  id: 'ics-to-csv',
  slug: 'ics-to-csv',
  name: 'ICS to CSV',
  description:
    'Convert iCalendar events to CSV or JSON. DTSTART and DTEND retain their raw values alongside best-effort ISO text; TZID values are labels only, with no timezone database conversion. RRULE values are preserved but recurrences are not expanded.',
  llmDescription:
    'Convert a .ics calendar export into a CSV table or JSON event array. Handles unfolded VEVENT properties, all-day filtering, escaped text, and raw RRULE values. It does not perform TZID offset math or expand recurring events.',
  category: 'convert',
  categories: ['convert', 'export'],
  keywords: [
    'ics',
    'icalendar',
    'calendar',
    'event',
    'csv',
    'json',
    'convert',
    'export',
    'rrule',
  ],

  input: {
    accept: ['text/calendar'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'text/csv', multiple: false },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  chainSuggestions: ['csv-to-excel', 'csv-sort', 'csv-filter', 'csv-json'],
  defaults: defaultIcsToCsvParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'output format',
      help: 'Choose a CSV table or a JSON array with the same event fields.',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
    includeAllDay: {
      type: 'boolean',
      label: 'include all-day events',
      help: 'Include events whose DTSTART is a calendar date rather than a timed date-time.',
    },
  },

  async run(inputs: File[], params: IcsToCsvParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('ics-to-csv accepts exactly one calendar file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading calendar' });
    const text = await inputs[0]!.text();
    let events = parseEvents(text);
    if (!(params.includeAllDay ?? true)) events = events.filter((event) => !event.all_day);

    ctx.onProgress({ stage: 'processing', percent: 80, message: 'Formatting events' });
    const format = params.format ?? 'csv';
    const output = format === 'json' ? JSON.stringify(events, null, 2) : eventsToCsv(events);
    const mime = format === 'json' ? 'application/json' : 'text/csv';

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: mime })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv', 'application/json'],
  },
};
