import Papa from 'papaparse';

export type CsvDelimiter = 'auto' | 'comma' | 'tab' | 'semicolon' | 'pipe';
export interface CsvColumn {
  id: string;
  label: string;
}
export interface CsvRow {
  id: string;
  sourceRow: number;
  originalWidth: number;
  cells: string[];
}
export interface CsvTable {
  columns: CsvColumn[];
  rows: CsvRow[];
  warnings: { sourceRow: number; width: number }[];
  hasHeader: boolean;
  delimiter: string;
}
export interface CsvSelection {
  search?: string;
  columns?: string[];
  filters?: Record<string, string>;
  sort?: { column: string; direction: 'asc' | 'desc'; numeric?: boolean };
}
export interface CsvExportOptions {
  spreadsheetSafe?: boolean;
  rows?: CsvRow[];
  delimiter?: 'comma' | 'tab' | 'semicolon' | 'pipe';
}

const BYTE_CAP = 10 * 1024 * 1024;
const CELL_CAP = 1024 * 1024;
const EXPORT_CAP = 96 * 1024 * 1024;
const encoder = new TextEncoder();
const separators = { comma: ',', tab: '\t', semicolon: ';', pipe: '|' } as const;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('CSV operation cancelled.');
}

function object<T>(
  value: T,
  keys: readonly string[],
  label: string,
): asserts value is T & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: expected an object.`);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new Error(`${label}: expected a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error(`${label}: unknown field.`);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error(`${label}: data fields required.`);
  }
}

function list<T>(value: T, cap: number, label: string): asserts value is T & unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > cap ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    throw new Error(`${label}: invalid list or limit exceeded.`);
  if (Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error(`${label}: dense list required.`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error(`${label}: data cells required.`);
  }
}

function text(value: unknown, label: string, cap = CELL_CAP): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label}: expected a string cell.`);
  if (encoder.encode(value).byteLength > cap)
    throw new Error(`${label}: cell byte limit exceeded.`);
}

function charge(width: number, rows: number, utf16Bytes: number): void {
  if (width > 200) throw new Error('CSV column limit is 200.');
  if (rows > 100000) throw new Error('CSV data row limit is 100,000.');
  const cells = width * rows;
  if (cells > 2000000) throw new Error('CSV padded cell limit is 2,000,000.');
  if (2 * utf16Bytes + 64 * cells + 48 * rows + 128 * width > 192 * 1024 * 1024)
    throw new Error('CSV application allocation limit exceeded.');
}

function detectDelimiter(source: string): string {
  const start = source.match(/^[\r\n]*/)?.[0].length ?? 0;
  let end = start;
  let byteLength = 0;
  while (end < source.length) {
    const point = source.codePointAt(end)!;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (byteLength + size > 65536) break;
    byteLength += size;
    end += point > 0xffff ? 2 : 1;
  }
  const sample = source.slice(start, end);
  const candidates = Object.values(separators).filter((delimiter) => {
    const rows: string[][] = [];
    let invalid = false;
    Papa.parse<string[]>(sample, {
      delimiter,
      header: false,
      dynamicTyping: false,
      skipEmptyLines: false,
      step(result) {
        // Papa reports EOF quote errors on this step. A bounded sample may
        // end inside its final record; the full parser still checks all input.
        const tail = end < source.length && result.meta.cursor === sample.length;
        if (
          tail &&
          (result.errors.length || (!/[\r\n]$/.test(sample) && !/[\r\n]/.test(source[end]!)))
        )
          return;
        if (result.errors.length) {
          invalid = true;
          return;
        }
        if (result.data.some((cell) => cell.length > 0)) rows.push(result.data);
      },
    });
    if (invalid) return false;
    const width = rows[0]?.length ?? 0;
    return width > 1 && rows.every((row) => row.length === width);
  });
  if (candidates.length !== 1)
    throw new Error(
      'Choose an explicit CSV delimiter: automatic detection is ambiguous or inconsistent.',
    );
  return candidates[0]!;
}

export function parseCsv(
  bytes: Uint8Array,
  options: { delimiter: CsvDelimiter; hasHeader: boolean },
  signal?: AbortSignal,
): CsvTable {
  checkAbort(signal);
  object(options, ['delimiter', 'hasHeader'], 'CSV options');
  if (typeof options.hasHeader !== 'boolean') throw new Error('CSV header option must be boolean.');
  if (options.delimiter !== 'auto' && !Object.hasOwn(separators, options.delimiter))
    throw new Error('Unsupported CSV delimiter.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > BYTE_CAP)
    throw new Error('CSV input byte limit is 10 MiB.');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('CSV input must be valid UTF8.');
  }
  if (source.startsWith('\uFEFF')) source = source.slice(1);
  const delimiter =
    options.delimiter === 'auto'
      ? source
        ? detectDelimiter(source)
        : ','
      : separators[options.delimiter];
  const table: CsvTable = {
    columns: [],
    rows: [],
    warnings: [],
    hasHeader: options.hasHeader,
    delimiter,
  };
  if (!source) return table;
  let retainedBytes = 0;
  let recordNumber = 0;
  let headerWidth = 0;
  let header: string[] | undefined;
  let pending: string[] | undefined;
  let failure: Error | undefined;
  const commit = (cells: string[]) => {
    checkAbort(signal);
    const nextNumber = recordNumber + 1;
    const isHeader = options.hasHeader && nextNumber === 1;
    const nextWidth = Math.max(table.columns.length, cells.length);
    charge(nextWidth, table.rows.length + (isHeader ? 0 : 1), source.length * 2);
    for (const cell of cells) {
      text(cell, 'CSV cell');
      retainedBytes += encoder.encode(cell).byteLength;
      if (retainedBytes > BYTE_CAP) throw new Error('CSV retained text limit is 10 MiB.');
    }
    recordNumber = nextNumber;
    if (isHeader) {
      header = cells;
      headerWidth = cells.length;
    }
    if (nextWidth > table.columns.length) {
      table.columns = Array.from({ length: nextWidth }, (_, i) => ({
        id: `c${i}`,
        label: options.hasHeader ? (header?.[i] ?? '') : `Column ${i + 1}`,
      }));
    }
    if (!isHeader)
      table.rows.push({
        id: `r${nextNumber}`,
        sourceRow: nextNumber,
        originalWidth: cells.length,
        cells,
      });
  };
  Papa.parse<string[]>(source, {
    delimiter,
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    chunkSize: 512 * 1024,
    step(result, parser) {
      try {
        checkAbort(signal);
        if (result.errors.length)
          throw new Error(
            `CSV parse/quote error: ${result.errors[0]?.message ?? 'malformed input'}`,
          );
        if (result.data.length > 200) throw new Error('CSV column limit is 200.');
        for (const cell of result.data) text(cell, 'CSV cell');
        if (pending) commit(pending);
        pending = result.data;
      } catch (error) {
        failure = error instanceof Error ? error : new Error('CSV parse failed.');
        parser.abort();
      }
    },
  });
  if (failure) throw failure;
  if (
    (pending && !(source.endsWith('\n') || source.endsWith('\r'))) ||
    (pending && (pending.length !== 1 || pending[0] !== ''))
  )
    commit(pending);
  const width = table.columns.length;
  for (const row of table.rows) {
    if (row.originalWidth !== (options.hasHeader ? headerWidth : width))
      table.warnings.push({ sourceRow: row.sourceRow, width: row.originalWidth });
    while (row.cells.length < width) row.cells.push('');
  }
  checkAbort(signal);
  return table;
}

export function validateCsvTable(table: CsvTable, signal?: AbortSignal): void {
  object(table, ['columns', 'rows', 'warnings', 'hasHeader', 'delimiter'], 'CSV table');
  if (
    typeof table.hasHeader !== 'boolean' ||
    !Object.values(separators).includes(table.delimiter as ',')
  )
    throw new Error('Invalid CSV table options.');
  list(table.columns, 200, 'CSV columns');
  list(table.rows, 100000, 'CSV rows');
  list(table.warnings, 100000, 'CSV warnings');
  let totalBytes = 0;
  let totalUtf16 = 0;
  const countText = (cell: unknown) => {
    text(cell, 'CSV cell');
    totalBytes += encoder.encode(cell).byteLength;
    totalUtf16 += cell.length * 2;
    if (totalBytes > BYTE_CAP) throw new Error('CSV retained text limit is 10 MiB.');
  };
  table.columns.forEach((column, i) => {
    object(column, ['id', 'label'], 'CSV column');
    if (column.id !== `c${i}`) throw new Error('CSV column IDs must be canonical.');
    countText(column.label);
  });
  const ids = new Set<string>();
  for (const row of table.rows) {
    checkAbort(signal);
    object(row, ['id', 'sourceRow', 'originalWidth', 'cells'], 'CSV row');
    text(row.id, 'CSV row ID', 100);
    if (ids.has(row.id)) throw new Error('Duplicate CSV row ID.');
    ids.add(row.id);
    if (
      !Number.isSafeInteger(row.sourceRow) ||
      row.sourceRow < 1 ||
      !Number.isSafeInteger(row.originalWidth) ||
      row.originalWidth < 1 ||
      row.originalWidth > table.columns.length
    )
      throw new Error('Invalid CSV row provenance.');
    list(row.cells, 200, 'CSV row cells');
    if (row.cells.length !== table.columns.length) throw new Error('CSV rows must be rectangular.');
    row.cells.forEach(countText);
  }
  for (const warning of table.warnings) {
    object(warning, ['sourceRow', 'width'], 'CSV warning');
    if (
      !Number.isSafeInteger(warning.sourceRow) ||
      warning.sourceRow < 1 ||
      !Number.isSafeInteger(warning.width) ||
      warning.width < 1 ||
      warning.width > 200
    )
      throw new Error('Invalid CSV width warning.');
  }
  if (!table.columns.length && table.rows.length) throw new Error('CSV rows require columns.');
  charge(table.columns.length, table.rows.length, totalUtf16);
}

export function selectCsvRows(table: CsvTable, selection: CsvSelection = {}): CsvRow[] {
  validateCsvTable(table);
  object(selection, ['search', 'columns', 'filters', 'sort'], 'CSV selection');
  const columnIndex = (id: string) => {
    const i = table.columns.findIndex((column) => column.id === id);
    if (i < 0) throw new Error('Unknown CSV column.');
    return i;
  };
  const search = selection.search ?? '';
  text(search, 'CSV search');
  let indexes = table.columns.map((_, i) => i);
  if (selection.columns !== undefined) {
    list(selection.columns, 200, 'CSV selected columns');
    if (new Set(selection.columns).size !== selection.columns.length)
      throw new Error('Duplicate selected CSV column.');
    indexes = selection.columns.map((id) => {
      text(id, 'CSV selected column', 100);
      return columnIndex(id);
    });
  }
  const filters = selection.filters ?? {};
  if (!filters || typeof filters !== 'object' || Array.isArray(filters))
    throw new Error('CSV filters require an object.');
  object(
    filters,
    table.columns.map((column) => column.id),
    'CSV filters',
  );
  const filterEntries = Object.entries(filters).map(([id, value]) => {
    text(value, 'CSV filter');
    return [columnIndex(id), value.toLocaleLowerCase('en')] as const;
  });
  const query = search.toLocaleLowerCase('en');
  const rows = table.rows.filter(
    (row) =>
      (!query || indexes.some((i) => row.cells[i]!.toLocaleLowerCase('en').includes(query))) &&
      filterEntries.every(([i, value]) => row.cells[i]!.toLocaleLowerCase('en').includes(value)),
  );
  if (selection.sort) {
    const sort = selection.sort;
    object(sort, ['column', 'direction', 'numeric'], 'CSV sort');
    if (sort.direction !== 'asc' && sort.direction !== 'desc')
      throw new Error('Invalid CSV sort direction.');
    if (sort.numeric !== undefined && typeof sort.numeric !== 'boolean')
      throw new Error('CSV numeric sort must be boolean.');
    const index = columnIndex(sort.column);
    const number = (s: string) =>
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s.trim()) && Number.isFinite(Number(s))
        ? Number(s)
        : null;
    rows.sort((a, b) => {
      const left = a.cells[index]!;
      const right = b.cells[index]!;
      if (sort.numeric) {
        const x = number(left);
        const y = number(right);
        if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
        return (x - y) * (sort.direction === 'asc' ? 1 : -1);
      }
      const x = left.toLocaleLowerCase('en');
      const y = right.toLocaleLowerCase('en');
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.direction === 'asc' ? 1 : -1);
    });
  }
  return rows;
}

export function editCsvCell(
  table: CsvTable,
  rowId: string,
  columnId: string,
  value: string,
): CsvTable {
  validateCsvTable(table);
  text(value, 'CSV edited cell');
  const index = table.columns.findIndex((column) => column.id === columnId);
  if (index < 0) throw new Error('Unknown CSV column.');
  if (!table.rows.some((row) => row.id === rowId)) throw new Error('Unknown CSV row.');
  const result = {
    ...table,
    rows: table.rows.map((row) =>
      row.id === rowId
        ? { ...row, cells: row.cells.map((cell, i) => (i === index ? value : cell)) }
        : row,
    ),
  };
  validateCsvTable(result);
  return result;
}

export function exportCsv(
  table: CsvTable,
  options: CsvExportOptions = {},
  signal?: AbortSignal,
): string {
  validateCsvTable(table, signal);
  object(options, ['spreadsheetSafe', 'rows', 'delimiter'], 'CSV export options');
  if (options.spreadsheetSafe !== undefined && typeof options.spreadsheetSafe !== 'boolean')
    throw new Error('CSV spreadsheet-safe option must be boolean.');
  if (options.delimiter !== undefined && !Object.hasOwn(separators, options.delimiter))
    throw new Error('Unsupported CSV export delimiter.');
  const delimiter = options.delimiter === undefined ? ',' : separators[options.delimiter];
  const rows = options.rows ?? table.rows;
  list(rows, 100000, 'CSV export rows');
  const owned = new Set(table.rows);
  const selected = new Set<CsvRow>();
  for (const row of rows) {
    if (!owned.has(row) || selected.has(row))
      throw new Error('CSV export requires unique actual table rows.');
    selected.add(row);
  }
  const chunks: string[] = [];
  let total = 0;
  const add = (part: string) => {
    total += encoder.encode(part).byteLength;
    if (total > EXPORT_CAP) throw new Error('CSV export exceeds 96 MiB.');
    chunks.push(part);
  };
  const writeRow = (cells: string[]) => {
    checkAbort(signal);
    cells.forEach((cell, i) => {
      if (i) add(delimiter);
      const safe =
        options.spreadsheetSafe && (/^[\t\r\n]/.test(cell) || /^[\s]*[=+\-@]/.test(cell))
          ? `'${cell}`
          : cell;
      add(
        /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replaceAll('"', '""')}"` : safe,
      );
    });
    add('\r\n');
  };
  if (table.hasHeader && table.columns.length)
    writeRow(table.columns.map((column) => column.label));
  rows.forEach((row) => writeRow(row.cells));
  checkAbort(signal);
  return chunks.join('');
}
