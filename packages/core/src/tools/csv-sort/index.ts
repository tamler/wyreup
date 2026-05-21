import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvSortParams {
  /** Comma-separated column names (header) or 0-based indices. Blank → column 0. */
  sortColumns?: string;
  /** Whether the first row is a header. */
  hasHeader?: boolean;
  /** Field delimiter — auto-detected when blank. */
  delimiter?: string;
  /** Sort direction. */
  order?: 'asc' | 'desc';
  /** Numeric comparison instead of text. */
  numeric?: boolean;
}

export const defaultCsvSortParams: CsvSortParams = {
  sortColumns: '',
  hasHeader: true,
  delimiter: '',
  order: 'asc',
  numeric: false,
};

export interface CsvSortResult {
  rows: number;
  sortColumns: string[];
  order: 'asc' | 'desc';
  numeric: boolean;
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

export const csvSort: ToolModule<CsvSortParams> = {
  id: 'csv-sort',
  slug: 'csv-sort',
  name: 'CSV Sort',
  description:
    'Sort the rows of a CSV by one or more columns — ascending or descending, as text or numbers.',
  category: 'edit',
  keywords: ['csv', 'sort', 'order', 'arrange', 'rows', 'columns'],

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

  defaults: defaultCsvSortParams,

  paramSchema: {
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
      help: 'When on, sort columns are matched by name. When off, by 0-based index.',
    },
    sortColumns: {
      type: 'string',
      label: 'sort by columns',
      help: 'Comma-separated column names (with header) or indices. Blank = first column.',
      placeholder: 'date, amount  — or — 0, 2',
    },
    order: {
      type: 'enum',
      label: 'order',
      options: [
        { value: 'asc', label: 'ascending' },
        { value: 'desc', label: 'descending' },
      ],
    },
    numeric: {
      type: 'boolean',
      label: 'numeric sort',
      help: 'Compare values as numbers (10 after 9, not before).',
    },
    delimiter: {
      type: 'string',
      label: 'delimiter',
      help: 'Field separator. Blank = auto-detect.',
      placeholder: ',',
    },
  },

  async run(inputs: File[], params: CsvSortParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('csv-sort accepts exactly one CSV file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV parser' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const hasHeader = params.hasHeader ?? true;
    const delimiter = params.delimiter && params.delimiter.length > 0 ? params.delimiter : undefined;

    ctx.onProgress({ stage: 'processing', percent: 35, message: 'Parsing CSV' });
    const parsed = Papa.parse<string[]>(text, { header: false, delimiter, skipEmptyLines: true });
    const rows = parsed.data;
    if (rows.length === 0) throw new Error('CSV is empty.');

    const headerRow = hasHeader ? rows[0]! : null;
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const keyNames = (params.sortColumns ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const keyIndices =
      keyNames.length > 0
        ? keyNames.map((n) => resolveColumn(n, headerRow, hasHeader))
        : [0];

    const order = params.order ?? 'asc';
    const numeric = params.numeric ?? false;
    const dir = order === 'desc' ? -1 : 1;

    ctx.onProgress({ stage: 'processing', percent: 65, message: 'Sorting' });
    // Array.prototype.sort is stable (ES2019+), so equal rows keep input order.
    const sorted = dataRows.slice().sort((a, b) => {
      for (const i of keyIndices) {
        const av = a[i] ?? '';
        const bv = b[i] ?? '';
        let cmp: number;
        if (numeric) {
          const an = Number.parseFloat(av);
          const bn = Number.parseFloat(bv);
          cmp = (Number.isNaN(an) ? 0 : an) - (Number.isNaN(bn) ? 0 : bn);
        } else {
          cmp = av.localeCompare(bv);
        }
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });

    const outputRows = headerRow ? [headerRow, ...sorted] : sorted;
    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Writing CSV' });
    const outputCsv = Papa.unparse(outputRows, { delimiter: parsed.meta.delimiter });

    const stats: CsvSortResult = {
      rows: dataRows.length,
      sortColumns:
        hasHeader && headerRow
          ? keyIndices.map((i) => headerRow[i] ?? String(i))
          : keyIndices.map(String),
      order,
      numeric,
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
