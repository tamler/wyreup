import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonUnflattenParams {
  /** Separator that splits keys back into path components. */
  separator?: '.' | '_' | '/' | '-';
  /** Accept bracket-notation array indices (a[0].b) in addition to "0" segments. */
  bracketArrays?: boolean;
}

export const defaultJsonUnflattenParams: JsonUnflattenParams = {
  separator: '.',
  bracketArrays: true,
};

const JsonUnflattenComponentStub = (): unknown => null;

function parsePath(key: string, separator: string, bracketArrays: boolean): Array<string | number> {
  if (bracketArrays) {
    // Normalize a[0].b → a.0.b before split. Captures consecutive bracket
    // indices like a[0][1] correctly.
    const normalized = key.replace(/\[(\d+)\]/g, (_, n: string) => `${separator}${n}`);
    return normalized
      .split(separator)
      .filter((s) => s.length > 0)
      .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  }
  return key
    .split(separator)
    .filter((s) => s.length > 0)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

export function unflattenJson(flat: Record<string, unknown>, params: JsonUnflattenParams): unknown {
  const separator = params.separator ?? '.';
  const bracketArrays = params.bracketArrays ?? true;

  // If every top-level key is a numeric index, return an array root.
  // Otherwise an object root.
  const root: Record<string | number, unknown> = {};

  for (const [rawKey, value] of Object.entries(flat)) {
    const segments = parsePath(rawKey, separator, bracketArrays);
    if (segments.length === 0) {
      // Empty key — drop the value at the root if root is empty,
      // otherwise ignore (there's no meaningful place to put it).
      if (Object.keys(root).length === 0) return value;
      continue;
    }
    let cursor: Record<string | number, unknown> = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const nextSeg = segments[i + 1]!;
      const child = cursor[seg];
      if (child === undefined || child === null || typeof child !== 'object') {
        cursor[seg] = typeof nextSeg === 'number' ? [] : {};
      }
      cursor = cursor[seg] as Record<string | number, unknown>;
    }
    cursor[segments[segments.length - 1]!] = value;
  }

  // Promote root to an array if every key is a contiguous index starting at 0.
  const keys = Object.keys(root);
  const allIndex = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
  if (allIndex) {
    const arr: unknown[] = [];
    for (const k of keys.map(Number).sort((a, b) => a - b)) arr[k] = root[k];
    return arr;
  }
  return root;
}

export const jsonUnflatten: ToolModule<JsonUnflattenParams> = {
  id: 'json-unflatten',
  slug: 'json-unflatten',
  name: 'JSON Unflatten',
  description:
    'Inverse of json-flatten. Take a flat object with dot-notation keys (a.b.c) and rebuild the nested JSON structure. Round-trips with json-flatten.',
  category: 'convert',
  presence: 'both',
  keywords: ['json', 'unflatten', 'nest', 'expand', 'dot-notation', 'structure'],

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

  defaults: defaultJsonUnflattenParams,

  paramSchema: {
    separator: {
      type: 'enum',
      label: 'separator',
      options: [
        { value: '.', label: 'dot' },
        { value: '_', label: 'underscore' },
        { value: '/', label: 'slash' },
        { value: '-', label: 'hyphen' },
      ],
    },
    bracketArrays: {
      type: 'boolean',
      label: 'parse bracket arrays',
      help: 'Treat keys like a[0].b as a → 0 → b, matching json-flatten\'s bracket array style.',
    },
  },

  Component: JsonUnflattenComponentStub,

  async run(inputs: File[], params: JsonUnflattenParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('json-unflatten accepts exactly one JSON input.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing JSON' });
    const text = await inputs[0]!.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Input is not valid JSON: ${msg}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Input must be a JSON object with flat keys.');
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Unflattening' });
    const result = unflattenJson(parsed as Record<string, unknown>, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
