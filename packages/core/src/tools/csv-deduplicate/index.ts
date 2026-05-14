import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvDeduplicateParams {
  /**
   * Column names (header row) or 0-based indices (no header) to use as the
   * dedup key. Empty → full-row dedup.
   */
  keyColumns?: string;
  /** Whether the first row is a header. */
  hasHeader?: boolean;
  /** Field delimiter — auto-detected when blank. */
  delimiter?: string;
  /** Strategy when duplicates collide. */
  keep?: 'first' | 'last';
  /** Case-insensitive key comparison. */
  caseInsensitive?: boolean;
}

export const defaultCsvDeduplicateParams: CsvDeduplicateParams = {
  keyColumns: '',
  hasHeader: true,
  delimiter: '',
  keep: 'first',
  caseInsensitive: false,
};

export interface CsvDeduplicateResult {
  rowsIn: number;
  rowsOut: number;
  duplicatesRemoved: number;
  keyColumns: string[];
  keep: 'first' | 'last';
  delimiter: string;
}

function parseKeyList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function keyOf(row: unknown[], keyIndices: number[], caseInsensitive: boolean): string {
  if (keyIndices.length === 0) {
    const parts = row.map(stringifyCell);
    return caseInsensitive ? parts.join('').toLowerCase() : parts.join('');
  }
  const parts: string[] = [];
  for (const i of keyIndices) parts.push(stringifyCell(row[i]));
  return caseInsensitive ? parts.join('').toLowerCase() : parts.join('');
}

export const csvDeduplicate: ToolModule<CsvDeduplicateParams> = {
  id: 'csv-deduplicate',
  slug: 'csv-deduplicate',
  name: 'CSV Deduplicate',
  description:
    'Drop duplicate rows from a CSV — either by full-row match or by specific key columns. Choose whether the first or last duplicate wins.',
  category: 'edit',
  keywords: ['csv', 'deduplicate', 'dedup', 'unique', 'distinct', 'rows'],

  input: {
    accept: ['text/csv', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'text/csv',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCsvDeduplicateParams,

  paramSchema: {
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
      help: 'When on, key columns are matched by name. When off, by 0-based index.',
    },
    keyColumns: {
      type: 'string',
      label: 'key columns',
      help: 'Comma-separated column names (with header) or indices (without). Leave blank for full-row dedup.',
      placeholder: 'email, name  — or — 0, 2',
    },
    delimiter: {
      type: 'string',
      label: 'delimiter',
      help: 'Field separator. Blank = auto-detect.',
      placeholder: ',',
    },
    keep: {
      type: 'enum',
      label: 'keep',
      options: [
        { value: 'first', label: 'first occurrence' },
        { value: 'last', label: 'last occurrence' },
      ],
    },
    caseInsensitive: {
      type: 'boolean',
      label: 'case-insensitive',
      help: 'Treat keys "ALICE" and "alice" as equal.',
    },
  },

  async run(inputs: File[], params: CsvDeduplicateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('csv-deduplicate accepts exactly one CSV file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV parser' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const hasHeader = params.hasHeader ?? true;
    const delimiter = params.delimiter && params.delimiter.length > 0 ? params.delimiter : undefined;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing CSV' });
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      delimiter,
      skipEmptyLines: true,
    });
    const rows = parsed.data;
    if (rows.length === 0) throw new Error('CSV is empty.');

    let headerRow: string[] | null = null;
    let dataRows: string[][];
    if (hasHeader) {
      headerRow = rows[0]!;
      dataRows = rows.slice(1);
    } else {
      dataRows = rows;
    }

    const keyNames = parseKeyList(params.keyColumns ?? '');
    const keyIndices: number[] = [];
    if (keyNames.length > 0) {
      for (const name of keyNames) {
        if (hasHeader && headerRow) {
          const idx = headerRow.findIndex((h) => h === name);
          if (idx < 0) {
            const asInt = Number.parseInt(name, 10);
            if (Number.isInteger(asInt) && asInt >= 0 && asInt < headerRow.length) {
              keyIndices.push(asInt);
            } else {
              throw new Error(`Key column "${name}" not found in header.`);
            }
          } else {
            keyIndices.push(idx);
          }
        } else {
          const asInt = Number.parseInt(name, 10);
          if (!Number.isInteger(asInt) || asInt < 0) {
            throw new Error(`Without a header, key columns must be 0-based indices (got "${name}").`);
          }
          keyIndices.push(asInt);
        }
      }
    }

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Deduplicating' });
    const caseInsensitive = params.caseInsensitive ?? false;
    const keep = params.keep ?? 'first';

    const seen = new Map<string, number>(); // key → index in output
    const kept: string[][] = [];
    for (const row of dataRows) {
      const k = keyOf(row, keyIndices, caseInsensitive);
      if (seen.has(k)) {
        if (keep === 'last') kept[seen.get(k)!] = row;
      } else {
        seen.set(k, kept.length);
        kept.push(row);
      }
    }

    const outputRows = headerRow ? [headerRow, ...kept] : kept;
    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Writing CSV' });
    const outputCsv = Papa.unparse(outputRows, { delimiter: parsed.meta.delimiter });

    const stats: CsvDeduplicateResult = {
      rowsIn: dataRows.length,
      rowsOut: kept.length,
      duplicatesRemoved: dataRows.length - kept.length,
      keyColumns: keyNames.length > 0
        ? (hasHeader ? keyIndices.map((i) => headerRow![i]!) : keyIndices.map(String))
        : ['<full row>'],
      keep,
      delimiter: parsed.meta.delimiter,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([outputCsv], { type: 'text/csv' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv', 'application/json'],
  },
};
