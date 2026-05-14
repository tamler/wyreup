import type { ToolModule, ToolRunContext } from '../../types.js';

export type JsonMergeStrategy = 'deep' | 'shallow' | 'overwrite';
export type JsonMergeArrayMode = 'concat' | 'replace' | 'union';

export interface JsonMergeParams {
  strategy?: JsonMergeStrategy;
  arrays?: JsonMergeArrayMode;
}

export const defaultJsonMergeParams: JsonMergeParams = {
  strategy: 'deep',
  arrays: 'replace',
};

export interface JsonMergeConflict {
  path: string;
  base: unknown;
  override: unknown;
}

export interface JsonMergeResult {
  merged: unknown;
  conflicts: JsonMergeConflict[];
  stats: {
    keysFromBase: number;
    keysFromOverride: number;
    conflictCount: number;
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeArrays(a: unknown[], b: unknown[], mode: JsonMergeArrayMode): unknown[] {
  if (mode === 'replace') return b;
  if (mode === 'concat') return [...a, ...b];
  // union — preserves order from a then appends novel items from b (JSON-equality based).
  const seen = new Set<string>(a.map((x) => JSON.stringify(x)));
  const out = [...a];
  for (const item of b) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      out.push(item);
      seen.add(key);
    }
  }
  return out;
}

export function mergeJson(
  base: unknown,
  override: unknown,
  params: JsonMergeParams,
): JsonMergeResult {
  const strategy = params.strategy ?? 'deep';
  const arrays = params.arrays ?? 'replace';
  const conflicts: JsonMergeConflict[] = [];
  let keysFromBase = 0;
  let keysFromOverride = 0;

  function recurse(a: unknown, b: unknown, path: string): unknown {
    // Override wins outright in overwrite mode (regardless of types).
    if (strategy === 'overwrite') {
      if (a !== undefined && b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) {
        conflicts.push({ path, base: a, override: b });
      }
      return b !== undefined ? b : a;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      return mergeArrays(a, b, arrays);
    }

    if (isObject(a) && isObject(b)) {
      const out: Record<string, unknown> = {};
      const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of allKeys) {
        const inA = k in a;
        const inB = k in b;
        const childPath = path === '$' ? `$.${k}` : `${path}.${k}`;
        if (inA && inB) {
          if (strategy === 'shallow') {
            // Shallow: override wins for any conflicting key without descending.
            if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
              conflicts.push({ path: childPath, base: a[k], override: b[k] });
            }
            out[k] = b[k];
            keysFromOverride++;
          } else {
            // Deep: recurse — the inner recurse handles conflict recording.
            out[k] = recurse(a[k], b[k], childPath);
            if (JSON.stringify(a[k]) === JSON.stringify(b[k])) keysFromBase++;
            else keysFromOverride++;
          }
        } else if (inA) {
          out[k] = a[k];
          keysFromBase++;
        } else {
          out[k] = b[k];
          keysFromOverride++;
        }
      }
      return out;
    }

    // Scalar-vs-scalar or type mismatch — override wins, conflict recorded if different.
    if (a !== undefined && b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) {
      conflicts.push({ path, base: a, override: b });
    }
    return b !== undefined ? b : a;
  }

  const merged = recurse(base, override, '$');
  return {
    merged,
    conflicts,
    stats: { keysFromBase, keysFromOverride, conflictCount: conflicts.length },
  };
}

export const jsonMerge: ToolModule<JsonMergeParams> = {
  id: 'json-merge',
  slug: 'json-merge',
  name: 'JSON Merge',
  description:
    'Deep-merge two JSON documents with a conflict report. Pass two files (base, override); the second wins on collisions. Picks an array strategy (replace / concat / union) and emits the merged result alongside a list of every path where base and override disagreed. Pairs with json-diff (compare) for change-management workflows.',
  category: 'dev',
  keywords: ['json', 'merge', 'deep-merge', 'config', 'diff', 'conflict'],

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

  defaults: defaultJsonMergeParams,

  paramSchema: {
    strategy: {
      type: 'enum',
      label: 'merge strategy',
      help: 'deep = recurse into objects; shallow = override wins at top level; overwrite = override wins everywhere',
      options: [
        { value: 'deep', label: 'deep' },
        { value: 'shallow', label: 'shallow' },
        { value: 'overwrite', label: 'overwrite' },
      ],
    },
    arrays: {
      type: 'enum',
      label: 'array mode',
      help: 'replace = override array wins; concat = append; union = dedupe by JSON-equality',
      options: [
        { value: 'replace', label: 'replace' },
        { value: 'concat', label: 'concat' },
        { value: 'union', label: 'union' },
      ],
    },
  },

  async run(inputs: File[], params: JsonMergeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 2) throw new Error('json-merge needs exactly two JSON files (base, override).');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing inputs' });
    const [baseText, overrideText] = await Promise.all(inputs.map((f) => f.text()));
    let base: unknown;
    let override: unknown;
    try {
      base = JSON.parse(baseText!);
    } catch (err) {
      throw new Error(`base (${inputs[0]!.name}) is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      override = JSON.parse(overrideText!);
    } catch (err) {
      throw new Error(`override (${inputs[1]!.name}) is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Merging' });
    const result = mergeJson(base, override, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
