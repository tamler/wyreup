import type { ToolModule, ToolRunContext } from '../../types.js';

export interface YamlValidateParams {
  /** Stop at duplicate keys (default true). YAML 1.2 allows them but they're almost always a bug. */
  rejectDuplicateKeys?: boolean;
  /** Schema strictness — 'core' is YAML 1.2 default, 'json' rejects YAML-specific types (tags, !! types, anchors). */
  schema?: 'core' | 'json' | 'failsafe';
}

export const defaultYamlValidateParams: YamlValidateParams = {
  rejectDuplicateKeys: true,
  schema: 'core',
};

export interface YamlValidateResult {
  valid: boolean;
  /** Parsed document shape when valid. */
  parsed: unknown;
  /** Diagnostic when invalid. */
  error?: {
    message: string;
    line?: number;
    column?: number;
    snippet?: string;
  };
  /** Quick structural summary of the parsed value. */
  summary?: {
    type: string;
    /** Top-level keys (for objects) or length (for arrays). */
    topKeys?: string[];
    topLength?: number;
  };
}

function summarize(value: unknown): YamlValidateResult['summary'] {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', topLength: value.length };
  if (typeof value === 'object') {
    return { type: 'object', topKeys: Object.keys(value) };
  }
  return { type: typeof value };
}

export const yamlValidate: ToolModule<YamlValidateParams> = {
  id: 'yaml-validate',
  slug: 'yaml-validate',
  name: 'YAML Validate',
  description:
    'Strict YAML parser with structural diagnostics. Different from json-yaml (which just converts) — this one catches duplicate keys, undefined anchors, and reports the precise line and column of any failure.',
  category: 'inspect',
  keywords: ['yaml', 'validate', 'parse', 'lint', 'syntax', 'config'],

  input: {
    accept: ['text/yaml', 'text/x-yaml', 'application/yaml', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultYamlValidateParams,

  paramSchema: {
    rejectDuplicateKeys: {
      type: 'boolean',
      label: 'reject duplicate keys',
      help: 'YAML 1.2 technically allows duplicates; turn this off only when matching a tool that does.',
    },
    schema: {
      type: 'enum',
      label: 'schema',
      help: 'Strictness of the YAML schema. JSON rejects all YAML-specific types.',
      options: [
        { value: 'core', label: 'core (YAML 1.2 default)' },
        { value: 'json', label: 'json (reject !!str, tags, anchors)' },
        { value: 'failsafe', label: 'failsafe (only strings, lists, maps)' },
      ],
    },
  },

  async run(inputs: File[], params: YamlValidateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('yaml-validate accepts exactly one file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading YAML parser' });
    const { load, JSON_SCHEMA, CORE_SCHEMA, FAILSAFE_SCHEMA, YAMLException } = await import('js-yaml');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing' });
    const text = await inputs[0]!.text();

    const schemaOption = params.schema === 'json'
      ? JSON_SCHEMA
      : params.schema === 'failsafe'
        ? FAILSAFE_SCHEMA
        : CORE_SCHEMA;

    try {
      const parsed = load(text, {
        schema: schemaOption,
        // js-yaml's `json: true` mode rejects duplicate keys.
        json: !(params.rejectDuplicateKeys ?? true),
      });
      const result: YamlValidateResult = {
        valid: true,
        parsed: parsed ?? null,
        summary: summarize(parsed ?? null),
      };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    } catch (err) {
      const ye = err instanceof YAMLException ? err : null;
      const result: YamlValidateResult = {
        valid: false,
        parsed: null,
        error: ye
          ? {
              message: ye.reason || ye.message,
              line: ye.mark?.line !== undefined ? ye.mark.line + 1 : undefined,
              column: ye.mark?.column !== undefined ? ye.mark.column + 1 : undefined,
              snippet: ye.mark?.snippet,
            }
          : { message: err instanceof Error ? err.message : String(err) },
      };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
    }
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
