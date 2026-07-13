import type { ToolModule, ToolRunContext } from '../../types.js';
import { runQuery, type FileToLoad } from './engine.js';

export interface CsvSqlParams {
  query: string;
  outputFormat?: 'csv' | 'json';
}

export const defaultCsvSqlParams: CsvSqlParams = {
  query: '',
  outputFormat: 'csv',
};

export const csvSql: ToolModule<CsvSqlParams> = {
  id: 'csv-sql',
  slug: 'csv-sql',
  name: 'SQL Query Across Files',
  description:
    'Load one or more CSV, JSON, or Excel files as tables, then run a SQL query across them. Each file becomes a table named after its filename. Join, aggregate, window-function, CTE — anything SQLite supports. Runs entirely in your browser; nothing uploads.',
  category: 'dev',
  keywords: ['sql', 'sqlite', 'csv', 'query', 'join', 'aggregate', 'group-by', 'data', 'analytics'],

  input: {
    accept: [
      'text/csv',
      'text/plain',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    min: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'text/csv' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  chainSuggestions: ['csv-sort', 'csv-filter', 'csv-json', 'csv-to-excel'],

  defaults: defaultCsvSqlParams,
  paramSchema: {
    query: {
      type: 'string',
      label: 'SQL query',
      placeholder:
        'SELECT customer, SUM(amount) AS total FROM orders GROUP BY customer ORDER BY total DESC',
      help: 'Each input file becomes a table named after its filename (lowercase, non-alphanumerics → underscore). All columns are TEXT — cast with CAST(col AS REAL) etc. as needed.',
      multiline: true,
    },
    outputFormat: {
      type: 'enum',
      label: 'output format',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
  },

  async run(inputs: File[], params: CsvSqlParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length === 0) throw new Error('csv-sql needs at least one input file.');
    const sql = params.query?.trim();
    if (!sql) throw new Error('Enter a SQL query.');

    ctx.onProgress({
      stage: 'loading-deps',
      percent: 5,
      message: 'Loading SQLite engine',
    });
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 25, message: 'Loading tables' });
    const files: FileToLoad[] = await Promise.all(
      inputs.map(async (f) => ({
        name: f.name,
        bytes: new Uint8Array(await f.arrayBuffer()),
        mime: f.type,
      })),
    );
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 65, message: 'Running query' });
    const result = await runQuery(files, sql);

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Formatting result' });
    const format = params.outputFormat ?? 'csv';
    if (format === 'json') {
      const objs = result.rows.map((row) => {
        const o: Record<string, unknown> = {};
        result.columns.forEach((c, i) => {
          o[c] = row[i] ?? null;
        });
        return o;
      });
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' })];
    }

    // CSV via papaparse
    const Papa = (await import('papaparse')).default;
    const csv = Papa.unparse({
      fields: result.columns,
      data: result.rows.map((row) => row.map((v) => (v === null ? '' : v))),
    });
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([csv], { type: 'text/csv' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv', 'application/json'],
  },
};
