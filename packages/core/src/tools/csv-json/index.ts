import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvJsonParams {
  direction?: 'auto' | 'csv-to-json' | 'json-to-csv' | 'csv-to-csv';
  arrayStyle?: 'objects' | 'arrays';
  delimiter?: string;
  sourceDelimiter?: ',' | '\t' | ';' | '|';
  targetDelimiter?: ',' | '\t' | ';' | '|';
  recordNewline?: 'preserve' | 'lf' | 'crlf';
}

export const defaultCsvJsonParams: CsvJsonParams = {
  direction: 'auto',
  arrayStyle: 'objects',
  delimiter: ',',
  sourceDelimiter: ',',
  targetDelimiter: ',',
  recordNewline: 'preserve',
};

// Simple CSV parser with quote-awareness
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvToJson(text: string, delimiter: string, arrayStyle: 'objects' | 'arrays'): unknown[] {
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return [];

  if (arrayStyle === 'arrays') {
    return rows;
  }

  const headers = rows[0]!;
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });
}

function escapeField(val: string, delimiter: string): string {
  if (val.includes('"') || val.includes(delimiter) || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function jsonToCsv(data: unknown[], delimiter: string): string {
  if (data.length === 0) return '';

  function toStr(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    // v is now string | number | boolean | symbol | bigint
    return (v as string | number | boolean).toString();
  }

  // If array of arrays (arrayStyle='arrays')
  if (Array.isArray(data[0])) {
    return (data as unknown[][])
      .map((row) => row.map((v) => escapeField(toStr(v), delimiter)).join(delimiter))
      .join('\n');
  }

  // Array of objects
  const rows = data as Record<string, unknown>[];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = keys.map((k) => escapeField(k, delimiter)).join(delimiter);
  const body = rows.map((row) =>
    keys.map((k) => escapeField(toStr(row[k]), delimiter)).join(delimiter),
  );
  return [header, ...body].join('\n');
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('[') || t.startsWith('{');
}

export const csvJson: ToolModule<CsvJsonParams> = {
  id: 'csv-json',
  slug: 'csv-json',
  name: 'CSV ↔ JSON',
  description:
    'Convert between CSV and JSON, or change CSV delimiters with explicit source and target delimiters. Delimiter mode preserves cell values and quotes every cell; it supports multiline CSV within 5 MiB, 10000 rows and 100 columns.',
  category: 'dev',
  keywords: ['csv', 'json', 'convert', 'table', 'data', 'transform', 'spreadsheet'],

  input: {
    accept: ['text/csv', 'text/plain', 'application/json'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCsvJsonParams,

  paramSchema: {
    direction: {
      type: 'enum',
      label: 'Conversion',
      options: [
        { value: 'auto', label: 'Auto CSV/JSON' },
        { value: 'csv-to-json', label: 'CSV to JSON' },
        { value: 'json-to-csv', label: 'JSON to CSV' },
        { value: 'csv-to-csv', label: 'Change CSV delimiter' },
      ],
    },
    arrayStyle: {
      type: 'enum',
      label: 'JSON array style',
      options: [
        { value: 'objects', label: 'Objects' },
        { value: 'arrays', label: 'Arrays' },
      ],
      showWhen: { field: 'direction', in: ['auto', 'csv-to-json'] },
    },
    delimiter: {
      type: 'string',
      label: 'CSV delimiter',
      showWhen: { field: 'direction', in: ['auto', 'csv-to-json', 'json-to-csv'] },
    },
    sourceDelimiter: {
      type: 'enum',
      label: 'Source delimiter',
      options: [
        { value: ',', label: 'Comma' },
        { value: '\t', label: 'Tab' },
        { value: ';', label: 'Semicolon' },
        { value: '|', label: 'Pipe' },
      ],
      showWhen: { field: 'direction', equals: 'csv-to-csv' },
    },
    targetDelimiter: {
      type: 'enum',
      label: 'Target delimiter',
      options: [
        { value: ',', label: 'Comma' },
        { value: '\t', label: 'Tab' },
        { value: ';', label: 'Semicolon' },
        { value: '|', label: 'Pipe' },
      ],
      showWhen: { field: 'direction', equals: 'csv-to-csv' },
    },
    recordNewline: {
      type: 'enum',
      label: 'Record newline',
      options: [
        { value: 'preserve', label: 'Preserve detected record newline' },
        { value: 'lf', label: 'LF' },
        { value: 'crlf', label: 'CRLF' },
      ],
      help: 'Cell values and embedded newlines stay unchanged. Every cell is quoted; the presence of a final record terminator is preserved.',
      showWhen: { field: 'direction', equals: 'csv-to-csv' },
    },
  },

  async run(inputs: File[], params: CsvJsonParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (
      params.direction !== undefined &&
      !['auto', 'csv-to-json', 'json-to-csv', 'csv-to-csv'].includes(params.direction)
    )
      throw new Error('Invalid CSV direction');
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Converting' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    if (params.direction === 'csv-to-csv') {
      if (inputs.length !== 1 || !inputs[0]) throw new Error('Exactly one CSV file is required');
      if (inputs[0].size > 5 * 1024 * 1024) throw new Error('Delimiter conversion exceeds 5 MiB');
      const sourceDelimiter = params.sourceDelimiter ?? ',';
      const targetDelimiter = params.targetDelimiter ?? ',';
      if (
        ![',', '\t', ';', '|'].includes(sourceDelimiter) ||
        ![',', '\t', ';', '|'].includes(targetDelimiter)
      )
        throw new Error('CSV delimiters must be comma, tab, semicolon or pipe');
      const recordNewline = params.recordNewline ?? 'preserve';
      if (!['preserve', 'lf', 'crlf'].includes(recordNewline))
        throw new Error('Invalid CSV record newline');
      const text = await inputs[0].text();
      const { default: Papa } = await import('papaparse');
      if (ctx.signal.aborted) throw new Error('Aborted');
      const parsed = Papa.parse<string[]>(text, {
        delimiter: sourceDelimiter,
        header: false,
        dynamicTyping: false,
        skipEmptyLines: false,
        preview: 10002,
      });
      if (parsed.errors.length) throw new Error(`Invalid CSV: ${parsed.errors[0]!.message}`);
      const finalRow = parsed.data.at(-1);
      const trailingRecordTerminator =
        !!parsed.meta.linebreak &&
        text.endsWith(parsed.meta.linebreak) &&
        finalRow?.length === 1 &&
        finalRow[0] === '';
      if (trailingRecordTerminator) parsed.data.pop();
      if (parsed.meta.truncated || parsed.data.length > 10000)
        throw new Error('CSV exceeds 10000 rows');
      if (parsed.data.some((row) => row.length > 100)) throw new Error('CSV exceeds 100 columns');
      const newline =
        recordNewline === 'crlf'
          ? '\r\n'
          : recordNewline === 'lf'
            ? '\n'
            : parsed.meta.linebreak || '\n';
      const output =
        Papa.unparse(parsed.data, {
          delimiter: targetDelimiter,
          quotes: true,
          newline,
          header: false,
          skipEmptyLines: false,
        }) + (trailingRecordTerminator ? newline : '');
      if (ctx.signal.aborted) throw new Error('Aborted');
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([output], { type: 'text/plain' })];
    }

    const text = await inputs[0]!.text();
    const direction = params.direction ?? 'auto';
    const delimiter = params.delimiter ?? ',';
    const arrayStyle = params.arrayStyle ?? 'objects';

    const toJson = direction === 'csv-to-json' || (direction === 'auto' && !looksLikeJson(text));

    let result: string;
    if (toJson) {
      const data = csvToJson(text, delimiter, arrayStyle);
      result = JSON.stringify(data, null, 2);
    } else {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON: ${(e as Error).message}`);
      }
      if (!Array.isArray(data)) {
        throw new Error('JSON input must be an array');
      }
      result = jsonToCsv(data as unknown[], delimiter);
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
