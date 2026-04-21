import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvJsonParams {
  direction?: 'auto' | 'csv-to-json' | 'json-to-csv';
  arrayStyle?: 'objects' | 'arrays';
  delimiter?: string;
}

export const defaultCsvJsonParams: CsvJsonParams = {
  direction: 'auto',
  arrayStyle: 'objects',
  delimiter: ',',
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

const CsvJsonComponentStub = (): unknown => null;

export const csvJson: ToolModule<CsvJsonParams> = {
  id: 'csv-json',
  slug: 'csv-json',
  name: 'CSV ↔ JSON',
  description: 'Convert between CSV and JSON formats. Auto-detects direction from input.',
  category: 'dev',
  presence: 'both',
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

  Component: CsvJsonComponentStub,

  async run(
    inputs: File[],
    params: CsvJsonParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Converting' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const direction = params.direction ?? 'auto';
    const delimiter = params.delimiter ?? ',';
    const arrayStyle = params.arrayStyle ?? 'objects';

    const toJson = direction === 'csv-to-json'
      || (direction === 'auto' && !looksLikeJson(text));

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
