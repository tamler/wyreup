import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonSchemaInferParams {
  /** Mark every observed property as required. */
  requireAllKeys?: boolean;
  /** When false, leave `additionalProperties` undefined so the schema is permissive. */
  noAdditional?: boolean;
  /** Detect numeric strings (e.g. "42") and report them as integers, not strings. */
  coerceNumericStrings?: boolean;
  /** Include human-readable examples in the schema. */
  includeExamples?: boolean;
  /** Schema draft URI to emit. */
  draft?: 'draft-07' | 'draft-2020-12';
}

export const defaultJsonSchemaInferParams: JsonSchemaInferParams = {
  requireAllKeys: true,
  noAdditional: false,
  coerceNumericStrings: false,
  includeExamples: false,
  draft: 'draft-07',
};

const JsonSchemaInferComponentStub = (): unknown => null;

type Schema = Record<string, unknown>;

function unionTypes(a: Schema, b: Schema): Schema {
  // Merge two schemas inferred from sibling values (array element union).
  // Cheapest correct merge: collect `type` into an array, intersect `required`,
  // union `properties`, union `items`. For value types only, just collect.
  if (typeof a.type === 'string' && typeof b.type === 'string' && a.type === b.type && a.type !== 'object' && a.type !== 'array') {
    return a;
  }
  const aTypes = new Set<string>(Array.isArray(a.type) ? (a.type as string[]) : a.type ? [a.type as string] : []);
  const bTypes = new Set<string>(Array.isArray(b.type) ? (b.type as string[]) : b.type ? [b.type as string] : []);
  for (const t of bTypes) aTypes.add(t);
  const types = [...aTypes];
  const merged: Schema = { type: types.length === 1 ? types[0]! : types };

  if (a.type === 'object' && b.type === 'object') {
    const aProps = (a.properties as Record<string, Schema> | undefined) ?? {};
    const bProps = (b.properties as Record<string, Schema> | undefined) ?? {};
    const props: Record<string, Schema> = {};
    const keys = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);
    for (const k of keys) {
      if (aProps[k] && bProps[k]) props[k] = unionTypes(aProps[k], bProps[k]);
      else props[k] = aProps[k] ?? bProps[k]!;
    }
    merged.type = 'object';
    merged.properties = props;
    // Required = intersection of the two sides' requireds (so optional in one
    // → optional overall).
    const aReq = new Set<string>((a.required as string[] | undefined) ?? []);
    const bReq = new Set<string>((b.required as string[] | undefined) ?? []);
    const inter = [...aReq].filter((k) => bReq.has(k));
    if (inter.length > 0) merged.required = inter;
  } else if (a.type === 'array' && b.type === 'array') {
    merged.type = 'array';
    if (a.items && b.items) merged.items = unionTypes(a.items as Schema, b.items as Schema);
    else merged.items = (a.items ?? b.items) as Schema;
  }
  return merged;
}

export function inferSchema(value: unknown, params: JsonSchemaInferParams): Schema {
  const requireAllKeys = params.requireAllKeys ?? true;
  const noAdditional = params.noAdditional ?? false;
  const coerceNumericStrings = params.coerceNumericStrings ?? false;
  const includeExamples = params.includeExamples ?? false;

  function walk(node: unknown): Schema {
    if (node === null) return { type: 'null' };
    if (typeof node === 'boolean') return includeExamples ? { type: 'boolean', examples: [node] } : { type: 'boolean' };
    if (typeof node === 'number') {
      const type = Number.isInteger(node) ? 'integer' : 'number';
      return includeExamples ? { type, examples: [node] } : { type };
    }
    if (typeof node === 'string') {
      if (coerceNumericStrings && /^-?\d+$/.test(node)) {
        return { type: 'integer' };
      }
      // Recognize the common formats so the schema is actually useful for
      // downstream validators.
      const s: Schema = { type: 'string' };
      if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(node)) s.format = 'email';
      else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(node)) s.format = 'date-time';
      else if (/^\d{4}-\d{2}-\d{2}$/.test(node)) s.format = 'date';
      else if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(node)) s.format = 'uri';
      else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node)) s.format = 'uuid';
      if (includeExamples) s.examples = [node];
      return s;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) return { type: 'array' };
      let merged = walk(node[0]);
      for (let i = 1; i < node.length; i++) merged = unionTypes(merged, walk(node[i]));
      return { type: 'array', items: merged };
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const properties: Record<string, Schema> = {};
      const keys = Object.keys(obj);
      for (const k of keys) properties[k] = walk(obj[k]);
      const out: Schema = { type: 'object', properties };
      if (requireAllKeys && keys.length > 0) out.required = keys;
      if (noAdditional) out.additionalProperties = false;
      return out;
    }
    return {};
  }

  const draftUri = params.draft === 'draft-2020-12'
    ? 'https://json-schema.org/draft/2020-12/schema'
    : 'http://json-schema.org/draft-07/schema#';

  const schema = walk(value);
  return { $schema: draftUri, ...schema };
}

export const jsonSchemaInfer: ToolModule<JsonSchemaInferParams> = {
  id: 'json-schema-infer',
  slug: 'json-schema-infer',
  name: 'JSON Schema Infer',
  description:
    'Walk a JSON document and emit a draft schema that describes it. Round-trips with json-schema-validate — infer a schema, then validate the same document and the result is `valid: true`.',
  category: 'inspect',
  presence: 'both',
  keywords: ['json', 'schema', 'infer', 'generate', 'jsonschema', 'derive'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonSchemaInferParams,

  paramSchema: {
    requireAllKeys: {
      type: 'boolean',
      label: 'require all keys',
      help: 'Mark every observed top-level key as required. Off = leave required empty.',
    },
    noAdditional: {
      type: 'boolean',
      label: 'no additional properties',
      help: 'Set additionalProperties: false on every object. Strict but useful for closed schemas.',
    },
    coerceNumericStrings: {
      type: 'boolean',
      label: 'coerce numeric strings',
      help: 'Treat "42" as an integer when inferring the type.',
    },
    includeExamples: {
      type: 'boolean',
      label: 'include examples',
      help: 'Embed the observed value as an examples entry on each leaf schema.',
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

  Component: JsonSchemaInferComponentStub,

  async run(inputs: File[], params: JsonSchemaInferParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('json-schema-infer accepts exactly one JSON file.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing JSON' });
    const text = await inputs[0]!.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Input is not valid JSON: ${msg}`);
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Inferring schema' });
    const schema = inferSchema(parsed, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
