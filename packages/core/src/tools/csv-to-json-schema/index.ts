import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvToJsonSchemaParams {
  hasHeader?: boolean;
  delimiter?: string;
  /** Mark every column as required (recommended for closed-shape data). */
  requireAllColumns?: boolean;
  /** Set additionalProperties: false on the row schema. */
  noAdditional?: boolean;
  /** Schema draft URI to emit. */
  draft?: 'draft-07' | 'draft-2020-12';
}

export const defaultCsvToJsonSchemaParams: CsvToJsonSchemaParams = {
  hasHeader: true,
  delimiter: '',
  requireAllColumns: true,
  noAdditional: false,
  draft: 'draft-07',
};

const CsvToJsonSchemaComponentStub = (): unknown => null;

type ColumnType = 'integer' | 'number' | 'boolean' | 'string';

interface ColumnObservations {
  types: Set<ColumnType>;
  nullable: boolean;
  format?: 'date' | 'date-time' | 'email' | 'uri' | 'uuid';
  values: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const URI_RE = /^[a-z][a-z0-9+\-.]*:\/\//i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mirrors csv-info: 1/0 are integers, not booleans, so id columns don't
// get misclassified.
const BOOL_VALUES = new Set(['true', 'false', 'TRUE', 'FALSE', 'True', 'False', 'yes', 'no', 'Yes', 'No']);

function observe(col: ColumnObservations, value: string): void {
  if (value === '') {
    col.nullable = true;
    return;
  }
  col.values.push(value);
  if (BOOL_VALUES.has(value)) {
    col.types.add('boolean');
    return;
  }
  if (/^-?\d+$/.test(value)) {
    col.types.add('integer');
    return;
  }
  if (/^-?\d+\.\d+$/.test(value) || /^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value)) {
    col.types.add('number');
    return;
  }
  col.types.add('string');
  // Set format only if every observed string-typed value matches; on a mismatch later, clear it.
  if (col.format === undefined) {
    if (DATETIME_RE.test(value)) col.format = 'date-time';
    else if (DATE_RE.test(value)) col.format = 'date';
    else if (EMAIL_RE.test(value)) col.format = 'email';
    else if (URI_RE.test(value)) col.format = 'uri';
    else if (UUID_RE.test(value)) col.format = 'uuid';
  } else {
    const expected = col.format === 'date-time' ? DATETIME_RE
      : col.format === 'date' ? DATE_RE
      : col.format === 'email' ? EMAIL_RE
      : col.format === 'uri' ? URI_RE
      : UUID_RE;
    if (!expected.test(value)) col.format = undefined;
  }
}

function columnSchema(col: ColumnObservations): Record<string, unknown> {
  const types = col.types;
  if (types.size === 0) {
    // No non-empty values seen — emit a permissive null-only schema.
    return { type: 'null' };
  }
  let dominant: ColumnType;
  if (types.size === 1) {
    dominant = [...types][0]!;
  } else if (types.has('integer') && types.has('number') && types.size === 2) {
    dominant = 'number';
  } else {
    dominant = 'string';
  }

  const schema: Record<string, unknown> = { type: dominant };
  if (dominant === 'string' && col.format) schema.format = col.format;
  if (dominant === 'integer' || dominant === 'number') {
    const nums = col.values.map(Number).filter((n) => !Number.isNaN(n));
    if (nums.length > 0) {
      schema.minimum = Math.min(...nums);
      schema.maximum = Math.max(...nums);
    }
  }
  if (col.nullable) {
    schema.type = [dominant, 'null'];
  }
  return schema;
}

export const csvToJsonSchema: ToolModule<CsvToJsonSchemaParams> = {
  id: 'csv-to-json-schema',
  slug: 'csv-to-json-schema',
  name: 'CSV to JSON Schema',
  description:
    'Read a CSV and emit a JSON Schema that describes each row as an object. Per-column types are inferred from observed values, with min/max for numerics and format detection (date, date-time, email, uri, uuid) for strings. Pair with json-schema-validate to lock incoming CSVs to a known shape.',
  category: 'convert',
  presence: 'both',
  keywords: ['csv', 'json-schema', 'jsonschema', 'infer', 'derive', 'validate', 'data'],

  input: {
    accept: ['text/csv', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCsvToJsonSchemaParams,

  paramSchema: {
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
    },
    delimiter: {
      type: 'string',
      label: 'delimiter',
      placeholder: ',',
    },
    requireAllColumns: {
      type: 'boolean',
      label: 'require all columns',
      help: 'Add every column to the schema\'s required array.',
    },
    noAdditional: {
      type: 'boolean',
      label: 'no additional properties',
      help: 'Reject extra columns by setting additionalProperties: false on the row schema.',
    },
    draft: {
      type: 'enum',
      label: 'schema draft',
      options: [
        { value: 'draft-07', label: 'draft-07 (default — widest support)' },
        { value: 'draft-2020-12', label: 'draft-2020-12' },
      ],
    },
  },

  Component: CsvToJsonSchemaComponentStub,

  async run(inputs: File[], params: CsvToJsonSchemaParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('csv-to-json-schema accepts exactly one CSV file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV parser' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const hasHeader = params.hasHeader ?? true;
    const delimiter = params.delimiter && params.delimiter.length > 0 ? params.delimiter : undefined;

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Parsing' });
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
      header = Array.from({ length: all[0]!.length }, (_, i) => `col_${i}`);
      dataRows = all;
    }

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Inferring schema' });
    const observations: ColumnObservations[] = header.map(() => ({
      types: new Set<ColumnType>(),
      nullable: false,
      values: [],
    }));

    for (const row of dataRows) {
      for (let i = 0; i < header.length; i++) {
        observe(observations[i]!, row[i] ?? '');
      }
    }

    const properties: Record<string, unknown> = {};
    for (let i = 0; i < header.length; i++) {
      properties[header[i]!] = columnSchema(observations[i]!);
    }

    const draftUri = params.draft === 'draft-2020-12'
      ? 'https://json-schema.org/draft/2020-12/schema'
      : 'http://json-schema.org/draft-07/schema#';

    const rowSchema: Record<string, unknown> = {
      type: 'object',
      properties,
    };
    if (params.requireAllColumns ?? true) rowSchema.required = header;
    if (params.noAdditional) rowSchema.additionalProperties = false;

    const schema: Record<string, unknown> = {
      $schema: draftUri,
      type: 'array',
      items: rowSchema,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
