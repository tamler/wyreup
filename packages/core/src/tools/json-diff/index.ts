import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonDiffParams {
  /** Lines of context around changes in the unified diff. */
  context?: number;
  /** Sort object keys before diffing so reorderings aren't noise. */
  sortKeys?: boolean;
}

export const defaultJsonDiffParams: JsonDiffParams = {
  context: 3,
  sortKeys: true,
};

export interface JsonDiffStats {
  additions: number;
  deletions: number;
  changes: number;
}

function canonicalize(value: unknown, sortKeys: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, sortKeys));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = sortKeys ? Object.keys(obj).sort() : Object.keys(obj);
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalize(obj[k], sortKeys);
    return out;
  }
  return value;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} is not valid JSON: ${msg}`);
  }
}

export const jsonDiff: ToolModule<JsonDiffParams> = {
  id: 'json-diff',
  slug: 'json-diff',
  name: 'JSON Diff',
  description:
    'Compare two JSON files and produce a unified diff over their canonical (key-sorted) pretty form. Reorderings vanish; real changes stand out.',
  category: 'inspect',
  keywords: ['json', 'diff', 'compare', 'changes', 'unified', 'patch'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 2,
    max: 2,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: true,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonDiffParams,

  paramSchema: {
    context: {
      type: 'number',
      label: 'context lines',
      help: 'Lines of unchanged context around each change.',
      min: 0,
      max: 20,
      step: 1,
    },
    sortKeys: {
      type: 'boolean',
      label: 'sort keys',
      help: 'Canonicalize key order before diffing so {"a":1,"b":2} and {"b":2,"a":1} compare equal.',
    },
  },

  async run(inputs: File[], params: JsonDiffParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 2) throw new Error('json-diff requires exactly two JSON files.');
    const context = params.context ?? 3;
    const sortKeys = params.sortKeys ?? true;

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading diff library' });
    const { createTwoFilesPatch } = await import('diff');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing JSON' });
    const a = parseJson(await inputs[0]!.text(), inputs[0]!.name || 'file1');
    const b = parseJson(await inputs[1]!.text(), inputs[1]!.name || 'file2');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Canonicalizing' });
    const aText = JSON.stringify(canonicalize(a, sortKeys), null, 2);
    const bText = JSON.stringify(canonicalize(b, sortKeys), null, 2);

    ctx.onProgress({ stage: 'processing', percent: 80, message: 'Diffing' });
    const patch = createTwoFilesPatch(
      inputs[0]!.name || 'file1.json',
      inputs[1]!.name || 'file2.json',
      aText,
      bText,
      '',
      '',
      { context },
    );

    let additions = 0;
    let deletions = 0;
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    const stats: JsonDiffStats = { additions, deletions, changes: additions + deletions };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([patch], { type: 'text/plain' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'application/json'],
  },
};
