import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonFlattenParams {
  /** Separator between path components. Defaults to "." */
  separator?: '.' | '_' | '/' | '-';
  /** How to render array indices: dot-notation "a.0.b" or bracket-notation "a[0].b". */
  arrayStyle?: 'dot' | 'bracket';
  /** When true, render arrays inline as JSON strings rather than flattening their elements. */
  preserveArrays?: boolean;
}

export const defaultJsonFlattenParams: JsonFlattenParams = {
  separator: '.',
  arrayStyle: 'dot',
  preserveArrays: false,
};

export function flattenJson(
  value: unknown,
  params: JsonFlattenParams,
): Record<string, unknown> {
  const separator = params.separator ?? '.';
  const arrayStyle = params.arrayStyle ?? 'dot';
  const preserveArrays = params.preserveArrays ?? false;

  const out: Record<string, unknown> = {};

  function walk(node: unknown, path: string): void {
    if (node === null || node === undefined) {
      out[path || ''] = node;
      return;
    }
    if (Array.isArray(node)) {
      if (preserveArrays || node.length === 0) {
        out[path || ''] = node;
        return;
      }
      for (let i = 0; i < node.length; i++) {
        const segment = arrayStyle === 'bracket' ? `[${i}]` : String(i);
        const next = arrayStyle === 'bracket'
          ? (path ? `${path}${segment}` : segment)
          : (path ? `${path}${separator}${segment}` : segment);
        walk(node[i], next);
      }
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        out[path || ''] = obj;
        return;
      }
      for (const key of keys) {
        const next = path ? `${path}${separator}${key}` : key;
        walk(obj[key], next);
      }
      return;
    }
    out[path || ''] = node;
  }

  walk(value, '');
  return out;
}

export const jsonFlatten: ToolModule<JsonFlattenParams> = {
  id: 'json-flatten',
  slug: 'json-flatten',
  name: 'JSON Flatten',
  description:
    'Flatten nested JSON into a single-level object with dot-notation keys (a.b.c). Useful for CSV / spreadsheet export, search-index normalization, and env-var generation.',
  category: 'convert',
  keywords: ['json', 'flatten', 'flat', 'dot-notation', 'normalize', 'nested', 'object'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonFlattenParams,

  paramSchema: {
    separator: {
      type: 'enum',
      label: 'separator',
      options: [
        { value: '.', label: 'dot — a.b.c' },
        { value: '_', label: 'underscore — a_b_c' },
        { value: '/', label: 'slash — a/b/c' },
        { value: '-', label: 'hyphen — a-b-c' },
      ],
    },
    arrayStyle: {
      type: 'enum',
      label: 'array style',
      help: 'How to render array indices in keys.',
      options: [
        { value: 'dot', label: 'dot — a.0.b' },
        { value: 'bracket', label: 'bracket — a[0].b' },
      ],
    },
    preserveArrays: {
      type: 'boolean',
      label: 'preserve arrays',
      help: 'Leave arrays intact instead of flattening their elements into separate keys.',
    },
  },

  async run(inputs: File[], params: JsonFlattenParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('json-flatten accepts exactly one JSON input.');
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

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Flattening' });
    const flat = flattenJson(parsed, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(flat, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
