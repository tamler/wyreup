import type { ToolModule, ToolRunContext } from '../../types.js';

export interface SqlFormatterParams {
  language?: 'sql' | 'postgresql' | 'mysql' | 'sqlite' | 'bigquery';
  keywordCase?: 'upper' | 'lower' | 'preserve';
  indent?: number;
}

export const defaultSqlFormatterParams: SqlFormatterParams = {
  language: 'sql',
  keywordCase: 'upper',
  indent: 2,
};

const SqlFormatterComponentStub = (): unknown => null;

export const sqlFormatter: ToolModule<SqlFormatterParams> = {
  id: 'sql-formatter',
  slug: 'sql-formatter',
  name: 'SQL Formatter',
  description: 'Beautify and format SQL queries with configurable keyword casing and indentation.',
  category: 'dev',
  presence: 'both',
  keywords: ['sql', 'format', 'beautify', 'query', 'database', 'postgresql', 'mysql', 'sqlite'],

  input: {
    accept: ['text/plain', 'application/sql'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultSqlFormatterParams,

  paramSchema: {
    language: {
      type: 'enum',
      label: 'Dialect',
      options: [
        { value: 'sql', label: 'Standard SQL' },
        { value: 'postgresql', label: 'PostgreSQL' },
        { value: 'mysql', label: 'MySQL' },
        { value: 'sqlite', label: 'SQLite' },
        { value: 'bigquery', label: 'BigQuery' },
      ],
    },
    keywordCase: {
      type: 'enum',
      label: 'Keyword case',
      options: [
        { value: 'upper', label: 'UPPER (SELECT, FROM, WHERE)' },
        { value: 'lower', label: 'lower (select, from, where)' },
        { value: 'preserve', label: 'Preserve (as written)' },
      ],
    },
    indent: {
      type: 'number',
      label: 'Indent spaces',
      min: 0,
      max: 8,
      step: 1,
    },
  },

  Component: SqlFormatterComponentStub,

  async run(
    inputs: File[],
    params: SqlFormatterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading SQL formatter' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const { format } = await import('sql-formatter');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Formatting SQL' });

    const text = await inputs[0]!.text();
    const language = params.language ?? 'sql';
    const keywordCase = params.keywordCase ?? 'upper';
    const indent = params.indent ?? 2;

    let result: string;
    try {
      // sql-formatter's 'language' type is a union we can't easily express; cast via unknown
      result = format(text, { language: language as unknown as 'sql', keywordCase, tabWidth: indent });
    } catch (e) {
      throw new Error(`SQL formatting failed: ${(e as Error).message}`);
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
