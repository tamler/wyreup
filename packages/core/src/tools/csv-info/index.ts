import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvInfoParams {
  hasHeader?: boolean;
  delimiter?: string;
  /** Sample at most this many rows for type inference. 0 = scan all. */
  sampleRows?: number;
  /** Track distinct value counts up to this cardinality before bailing out. */
  maxDistinct?: number;
}

export const defaultCsvInfoParams: CsvInfoParams = {
  hasHeader: true,
  delimiter: '',
  sampleRows: 0,
  maxDistinct: 100,
};

export type CsvType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'date-time' | 'empty';

export interface CsvColumnInfo {
  name: string;
  index: number;
  type: CsvType;
  /** Secondary types observed (in addition to the dominant one). */
  alsoSeen: CsvType[];
  nullCount: number;
  distinctCount: number | 'overflow';
  /** Sample of distinct values (capped at 10) — useful for human review. */
  samples: string[];
  /** Numeric range — only present for integer / number columns. */
  min?: number;
  max?: number;
  /** Length range — only present for string columns. */
  minLength?: number;
  maxLength?: number;
}

export interface CsvInfoResult {
  rows: number;
  columns: number;
  delimiter: string;
  hasHeader: boolean;
  rowWidthConsistent: boolean;
  rowWidthHistogram: Record<number, number>;
  columnInfo: CsvColumnInfo[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
// Intentionally excludes '1' / '0' — those should type as integer. CSVs
// that use 1/0 for boolean flags end up typed as integer-with-range-[0..1],
// which is more useful for downstream schemas anyway.
const BOOL_VALUES = new Set(['true', 'false', 'TRUE', 'FALSE', 'True', 'False', 'yes', 'no', 'Yes', 'No']);

function detectType(value: string): CsvType {
  if (value === '') return 'empty';
  if (BOOL_VALUES.has(value)) return 'boolean';
  if (/^-?\d+$/.test(value)) return 'integer';
  if (/^-?\d+\.\d+$/.test(value) || /^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value)) return 'number';
  if (DATETIME_RE.test(value)) return 'date-time';
  if (DATE_RE.test(value)) return 'date';
  return 'string';
}

// Numeric tiers — integer is the strongest, string is the weakest. When a
// column has mixed types, the dominant type is the strictest one that fits
// every non-null value.
const TYPE_ORDER: CsvType[] = ['integer', 'number', 'boolean', 'date-time', 'date', 'string'];

function dominantType(observed: Set<CsvType>): CsvType {
  if (observed.size === 0 || (observed.size === 1 && observed.has('empty'))) return 'empty';
  const live = new Set(observed);
  live.delete('empty');
  // If both integer and number show up, the column is `number` (numeric, may have decimals).
  if (live.has('integer') && live.has('number')) {
    live.delete('integer');
  }
  if (live.size === 1) return [...live][0]!;
  // Mixed types → string.
  return 'string';
}

export const csvInfo: ToolModule<CsvInfoParams> = {
  id: 'csv-info',
  slug: 'csv-info',
  name: 'CSV Info',
  description:
    'Per-column statistics for a CSV: inferred type, null count, distinct count, numeric range, length range, plus a row-width consistency check. The diagnostic you want before piping a CSV into anything that cares about schema.',
  category: 'inspect',
  keywords: ['csv', 'info', 'stats', 'profile', 'columns', 'types', 'schema'],

  input: {
    accept: ['text/csv', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCsvInfoParams,

  paramSchema: {
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
    },
    delimiter: {
      type: 'string',
      label: 'delimiter',
      help: 'Blank = auto-detect.',
      placeholder: ',',
    },
    sampleRows: {
      type: 'number',
      label: 'sample rows',
      help: 'Cap rows used for type inference (0 = scan every row).',
      min: 0,
      max: 1000000,
      step: 100,
    },
    maxDistinct: {
      type: 'number',
      label: 'max distinct',
      help: 'Stop counting distinct values past this cardinality (per column).',
      min: 1,
      max: 10000,
      step: 10,
    },
  },

  async run(inputs: File[], params: CsvInfoParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('csv-info accepts exactly one CSV file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV parser' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const hasHeader = params.hasHeader ?? true;
    const delimiter = params.delimiter && params.delimiter.length > 0 ? params.delimiter : undefined;
    const sampleRows = params.sampleRows ?? 0;
    const maxDistinct = params.maxDistinct ?? 100;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing CSV' });
    const text = await inputs[0]!.text();
    const parsed = Papa.parse<string[]>(text, { header: false, delimiter, skipEmptyLines: true });
    const all = parsed.data;
    if (all.length === 0) throw new Error('CSV is empty.');

    let header: string[];
    let dataRows: string[][];
    if (hasHeader) {
      header = all[0]!;
      dataRows = all.slice(1);
    } else {
      const width = all[0]!.length;
      header = Array.from({ length: width }, (_, i) => `col_${i}`);
      dataRows = all;
    }

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Profiling columns' });
    const widthHistogram: Record<number, number> = {};
    for (const row of dataRows) {
      widthHistogram[row.length] = (widthHistogram[row.length] ?? 0) + 1;
    }
    const widthsSeen = Object.keys(widthHistogram).length;

    const rowsScanned = sampleRows > 0 ? Math.min(dataRows.length, sampleRows) : dataRows.length;

    const columnInfo: CsvColumnInfo[] = header.map((name, i) => {
      const observed = new Set<CsvType>();
      let nullCount = 0;
      const distinct = new Set<string>();
      let distinctOverflow = false;
      let minNum = Infinity;
      let maxNum = -Infinity;
      let minLen = Infinity;
      let maxLen = -Infinity;
      let sawNumeric = false;

      for (let r = 0; r < rowsScanned; r++) {
        const value = dataRows[r]?.[i] ?? '';
        const t = detectType(value);
        observed.add(t);
        if (t === 'empty') {
          nullCount++;
          continue;
        }
        if (!distinctOverflow) {
          distinct.add(value);
          if (distinct.size > maxDistinct) distinctOverflow = true;
        }
        if (t === 'integer' || t === 'number') {
          const n = Number(value);
          if (n < minNum) minNum = n;
          if (n > maxNum) maxNum = n;
          sawNumeric = true;
        }
        if (value.length < minLen) minLen = value.length;
        if (value.length > maxLen) maxLen = value.length;
      }

      const dominant = dominantType(observed);
      const alsoSeen = [...observed].filter((t) => t !== dominant && t !== 'empty');
      // Sort alsoSeen by TYPE_ORDER for a stable presentation.
      alsoSeen.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));

      const info: CsvColumnInfo = {
        name,
        index: i,
        type: dominant,
        alsoSeen,
        nullCount,
        distinctCount: distinctOverflow ? 'overflow' : distinct.size,
        samples: [...distinct].slice(0, 10),
      };
      if (sawNumeric && minNum !== Infinity) {
        info.min = minNum;
        info.max = maxNum;
      }
      if (minLen !== Infinity) {
        info.minLength = minLen;
        info.maxLength = maxLen;
      }
      return info;
    });

    const result: CsvInfoResult = {
      rows: dataRows.length,
      columns: header.length,
      delimiter: parsed.meta.delimiter,
      hasHeader,
      rowWidthConsistent: widthsSeen <= 1,
      rowWidthHistogram: widthHistogram,
      columnInfo,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
