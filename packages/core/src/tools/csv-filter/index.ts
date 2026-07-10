import type { ToolModule, ToolRunContext } from '../../types.js';

export type CsvFilterOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'not-contains'
  | 'greater-than'
  | 'less-than'
  | 'empty'
  | 'not-empty';

export interface CsvFilterParams {
  /** Column name (header) or 0-based index to test. */
  column?: string;
  /** Comparison to apply. */
  operator?: CsvFilterOperator;
  /** Value to compare against (ignored for empty / not-empty). */
  value?: string;
  /** Whether the first row is a header. */
  hasHeader?: boolean;
  /** Field delimiter — auto-detected when blank. */
  delimiter?: string;
  /** Case-insensitive text comparison. */
  caseInsensitive?: boolean;
}

export const defaultCsvFilterParams: CsvFilterParams = {
  column: '',
  operator: 'equals',
  value: '',
  hasHeader: true,
  delimiter: '',
  caseInsensitive: false,
};

export interface CsvFilterResult {
  rowsIn: number;
  rowsOut: number;
  rowsRemoved: number;
  column: string;
  operator: CsvFilterOperator;
  delimiter: string;
}

function resolveColumn(name: string, headerRow: string[] | null, hasHeader: boolean): number {
  if (hasHeader && headerRow) {
    const idx = headerRow.findIndex((h) => h === name);
    if (idx >= 0) return idx;
    const asInt = Number.parseInt(name, 10);
    if (Number.isInteger(asInt) && asInt >= 0 && asInt < headerRow.length) return asInt;
    throw new Error(`Column "${name}" not found in header.`);
  }
  const asInt = Number.parseInt(name, 10);
  if (!Number.isInteger(asInt) || asInt < 0) {
    throw new Error(`Without a header, columns must be 0-based indices (got "${name}").`);
  }
  return asInt;
}

function matches(
  cell: string,
  operator: CsvFilterOperator,
  value: string,
  caseInsensitive: boolean,
): boolean {
  const c = caseInsensitive ? cell.toLowerCase() : cell;
  const v = caseInsensitive ? value.toLowerCase() : value;
  switch (operator) {
    case 'equals':
      return c === v;
    case 'not-equals':
      return c !== v;
    case 'contains':
      return c.includes(v);
    case 'not-contains':
      return !c.includes(v);
    case 'greater-than': {
      const cn = Number.parseFloat(cell);
      const vn = Number.parseFloat(value);
      return !Number.isNaN(cn) && !Number.isNaN(vn) && cn > vn;
    }
    case 'less-than': {
      const cn = Number.parseFloat(cell);
      const vn = Number.parseFloat(value);
      return !Number.isNaN(cn) && !Number.isNaN(vn) && cn < vn;
    }
    case 'empty':
      return cell.trim() === '';
    case 'not-empty':
      return cell.trim() !== '';
  }
}

export const csvFilter: ToolModule<CsvFilterParams> = {
  id: 'csv-filter',
  slug: 'csv-filter',
  name: 'CSV Filter',
  description:
    'Keep only the CSV rows where a column matches a condition — equals, contains, greater/less than, empty, and more.',
  category: 'edit',
  keywords: ['csv', 'filter', 'where', 'rows', 'condition', 'select'],

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

  defaults: defaultCsvFilterParams,

  paramSchema: {
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
      help: 'When on, the column is matched by name. When off, by 0-based index.',
    },
    column: {
      type: 'string',
      label: 'column',
      help: 'Column name (with header) or 0-based index to test.',
      placeholder: 'status  — or — 2',
    },
    operator: {
      type: 'enum',
      label: 'condition',
      options: [
        { value: 'equals', label: 'equals' },
        { value: 'not-equals', label: 'does not equal' },
        { value: 'contains', label: 'contains' },
        { value: 'not-contains', label: 'does not contain' },
        { value: 'greater-than', label: 'greater than (number)' },
        { value: 'less-than', label: 'less than (number)' },
        { value: 'empty', label: 'is empty' },
        { value: 'not-empty', label: 'is not empty' },
      ],
    },
    value: {
      type: 'string',
      label: 'value',
      help: 'Value to compare against. Ignored for "is empty" / "is not empty".',
      placeholder: 'active',
    },
    caseInsensitive: {
      type: 'boolean',
      label: 'case-insensitive',
      help: 'Treat "Active" and "active" as equal.',
    },
    delimiter: {
      type: 'string',
      label: 'delimiter',
      help: 'Field separator. Blank = auto-detect.',
      placeholder: ',',
    },
  },

  async run(inputs: File[], params: CsvFilterParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('csv-filter accepts exactly one CSV file.');
    const columnName = (params.column ?? '').trim();
    if (!columnName) throw new Error('Choose a column to filter on.');

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV parser' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const hasHeader = params.hasHeader ?? true;
    const delimiter =
      params.delimiter && params.delimiter.length > 0 ? params.delimiter : undefined;

    ctx.onProgress({ stage: 'processing', percent: 35, message: 'Parsing CSV' });
    const parsed = Papa.parse<string[]>(text, { header: false, delimiter, skipEmptyLines: true });
    const rows = parsed.data;
    if (rows.length === 0) throw new Error('CSV is empty.');

    const headerRow = hasHeader ? rows[0]! : null;
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const colIndex = resolveColumn(columnName, headerRow, hasHeader);
    const operator = params.operator ?? 'equals';
    const value = params.value ?? '';
    const caseInsensitive = params.caseInsensitive ?? false;

    ctx.onProgress({ stage: 'processing', percent: 65, message: 'Filtering' });
    const kept = dataRows.filter((row) =>
      matches(row[colIndex] ?? '', operator, value, caseInsensitive),
    );

    const outputRows = headerRow ? [headerRow, ...kept] : kept;
    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Writing CSV' });
    const outputCsv = Papa.unparse(outputRows, { delimiter: parsed.meta.delimiter });

    const stats: CsvFilterResult = {
      rowsIn: dataRows.length,
      rowsOut: kept.length,
      rowsRemoved: dataRows.length - kept.length,
      column: hasHeader && headerRow ? (headerRow[colIndex] ?? String(colIndex)) : String(colIndex),
      operator,
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
