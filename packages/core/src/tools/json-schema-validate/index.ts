import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonSchemaValidateParams {
  /** Stop at the first error rather than collecting them all. */
  failFast?: boolean;
  /** Allow extra properties to make schemas backward-compatible by default. */
  allErrors?: boolean;
  /** Coerce types where reasonable (e.g. "42" → 42 for an integer field). */
  coerceTypes?: boolean;
}

export const defaultJsonSchemaValidateParams: JsonSchemaValidateParams = {
  failFast: false,
  allErrors: true,
  coerceTypes: false,
};

export interface JsonSchemaError {
  /** JSON Pointer to the offending value. */
  instancePath: string;
  /** JSON Pointer to the failing schema keyword. */
  schemaPath: string;
  keyword: string;
  message: string;
  /** ajv-side params (the failing values, missing key, etc.). */
  params: Record<string, unknown>;
}

export interface JsonSchemaValidateResult {
  valid: boolean;
  errors: JsonSchemaError[];
  /** Echoed back so callers can see what schema draft / dialect was used. */
  draft: string;
}

const JsonSchemaValidateComponentStub = (): unknown => null;

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} is not valid JSON: ${msg}`);
  }
}

function detectDraft(schema: unknown): string {
  if (schema && typeof schema === 'object' && '$schema' in schema) {
    const s = (schema as { $schema?: unknown }).$schema;
    if (typeof s === 'string') return s;
  }
  // ajv default is draft-07.
  return 'http://json-schema.org/draft-07/schema#';
}

export const jsonSchemaValidate: ToolModule<JsonSchemaValidateParams> = {
  id: 'json-schema-validate',
  slug: 'json-schema-validate',
  name: 'JSON Schema Validate',
  description:
    'Validate a JSON document against a JSON Schema. Built on ajv — supports draft-07 by default, with all errors listed at full JSON-Pointer paths so you can pinpoint the failing field.',
  category: 'inspect',
  presence: 'both',
  keywords: ['json', 'schema', 'validate', 'ajv', 'jsonschema', 'draft-07', 'openapi'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 2,
    max: 2,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonSchemaValidateParams,

  paramSchema: {
    allErrors: {
      type: 'boolean',
      label: 'collect all errors',
      help: 'Off = stop at the first error (faster). On = return every violation.',
    },
    coerceTypes: {
      type: 'boolean',
      label: 'coerce types',
      help: 'Allow ajv to coerce values where it can — e.g. "42" passes an "integer" field.',
    },
  },

  Component: JsonSchemaValidateComponentStub,

  async run(inputs: File[], params: JsonSchemaValidateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 2) throw new Error('json-schema-validate needs two files: schema then data.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading ajv' });
    const { default: Ajv } = await import('ajv');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing inputs' });
    const schemaText = await inputs[0]!.text();
    const dataText = await inputs[1]!.text();
    const schema = parseJson(schemaText, 'Schema');
    const data = parseJson(dataText, 'Data');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Compiling schema' });
    const allErrors = params.allErrors ?? true;
    const coerceTypes = params.coerceTypes ?? false;
    const ajv = new Ajv({ allErrors, coerceTypes, strict: false });
    // ajv throws synchronously on bad schemas — surface that as a clean error.
    let validate;
    try {
      validate = ajv.compile(schema as object);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not compile schema: ${msg}`);
    }

    ctx.onProgress({ stage: 'processing', percent: 85, message: 'Validating' });
    const valid = validate(data);
    const errors: JsonSchemaError[] = (validate.errors ?? []).map((e) => ({
      instancePath: e.instancePath,
      schemaPath: e.schemaPath,
      keyword: e.keyword,
      message: e.message ?? '',
      params: e.params as Record<string, unknown>,
    }));

    const result: JsonSchemaValidateResult = {
      valid,
      errors,
      draft: detectDraft(schema),
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
