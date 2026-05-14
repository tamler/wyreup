import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonPathParams {
  /** JSONPath expression. Common subset: $.a.b, $.items[0], $.items[*].id, $..deep. */
  expression?: string;
  /** Number of matches to return (0 = all). */
  limit?: number;
}

export const defaultJsonPathParams: JsonPathParams = {
  expression: '$',
  limit: 0,
};

export interface JsonPathMatch {
  path: string;
  value: unknown;
}

export interface JsonPathResult {
  expression: string;
  matchCount: number;
  matches: JsonPathMatch[];
}

interface Step {
  kind: 'root' | 'name' | 'index' | 'wildcard' | 'descend';
  name?: string;
  index?: number;
}

function tokenize(expr: string): Step[] {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error('json-path expression is empty.');
  let i = 0;
  const steps: Step[] = [];
  if (trimmed[0] === '$') {
    steps.push({ kind: 'root' });
    i++;
  }
  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    if (ch === '.') {
      if (trimmed[i + 1] === '.') {
        steps.push({ kind: 'descend' });
        i += 2;
        // `$..name` is shorthand for "descend then look up `name`" — the
        // recursive-descent step is normally followed by another step. Allow
        // an identifier or wildcard immediately after `..` without an
        // explicit `.` separator.
        if (i < trimmed.length && /[A-Za-z_*]/.test(trimmed[i]!)) {
          if (trimmed[i] === '*') {
            steps.push({ kind: 'wildcard' });
            i++;
          } else {
            let j = i;
            while (j < trimmed.length && /[A-Za-z0-9_-]/.test(trimmed[j]!)) j++;
            steps.push({ kind: 'name', name: trimmed.slice(i, j) });
            i = j;
          }
        }
        continue;
      }
      i++;
      // Read identifier or wildcard.
      if (trimmed[i] === '*') {
        steps.push({ kind: 'wildcard' });
        i++;
      } else {
        let j = i;
        while (j < trimmed.length && /[A-Za-z0-9_-]/.test(trimmed[j]!)) j++;
        if (j === i) throw new Error(`Unexpected character after "." at position ${i}.`);
        steps.push({ kind: 'name', name: trimmed.slice(i, j) });
        i = j;
      }
    } else if (ch === '[') {
      const close = trimmed.indexOf(']', i);
      if (close < 0) throw new Error('Unterminated [...] in JSONPath expression.');
      const body = trimmed.slice(i + 1, close).trim();
      if (body === '*') {
        steps.push({ kind: 'wildcard' });
      } else if (/^-?\d+$/.test(body)) {
        steps.push({ kind: 'index', index: Number(body) });
      } else if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
        steps.push({ kind: 'name', name: body.slice(1, -1) });
      } else {
        throw new Error(`Unsupported bracket selector: [${body}]`);
      }
      i = close + 1;
    } else {
      throw new Error(`Unexpected character "${ch}" at position ${i}.`);
    }
  }
  return steps;
}

function joinPath(prefix: string, segment: string | number): string {
  if (typeof segment === 'number') return `${prefix}[${segment}]`;
  return prefix ? `${prefix}.${segment}` : segment;
}

export function queryJsonPath(value: unknown, expr: string, limit = 0): JsonPathMatch[] {
  const steps = tokenize(expr);
  let current: Array<{ path: string; value: unknown }> = [{ path: '$', value }];

  for (const step of steps) {
    const next: Array<{ path: string; value: unknown }> = [];
    if (step.kind === 'root') {
      // root marker — current is already set
      continue;
    }
    if (step.kind === 'descend') {
      // Recursive descent: collect this node and every descendant.
      const collect = (node: unknown, path: string): void => {
        next.push({ path, value: node });
        if (Array.isArray(node)) {
          node.forEach((v, i) => collect(v, joinPath(path, i)));
        } else if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) collect(v, joinPath(path, k));
        }
      };
      for (const m of current) collect(m.value, m.path);
    } else if (step.kind === 'wildcard') {
      for (const m of current) {
        if (Array.isArray(m.value)) {
          m.value.forEach((v, i) => next.push({ path: joinPath(m.path, i), value: v }));
        } else if (m.value && typeof m.value === 'object') {
          for (const [k, v] of Object.entries(m.value)) {
            next.push({ path: joinPath(m.path, k), value: v });
          }
        }
      }
    } else if (step.kind === 'index') {
      for (const m of current) {
        if (Array.isArray(m.value)) {
          const idx = step.index! < 0 ? m.value.length + step.index! : step.index!;
          if (idx >= 0 && idx < m.value.length) {
            next.push({ path: joinPath(m.path, idx), value: m.value[idx] });
          }
        }
      }
    } else if (step.kind === 'name') {
      // Name selectors only apply to objects. Arrays don't have string keys
      // in JSON, and the descend step already visits each array element
      // individually so "$..price" still picks up array members.
      for (const m of current) {
        if (m.value && typeof m.value === 'object' && !Array.isArray(m.value)) {
          const obj = m.value as Record<string, unknown>;
          if (step.name! in obj) next.push({ path: joinPath(m.path, step.name!), value: obj[step.name!] });
        }
      }
    }
    current = next;
    if (current.length === 0) break;
  }

  const matches: JsonPathMatch[] = current;
  if (limit > 0 && matches.length > limit) return matches.slice(0, limit);
  return matches;
}

export const jsonPath: ToolModule<JsonPathParams> = {
  id: 'json-path',
  slug: 'json-path',
  name: 'JSON Path',
  description:
    'Extract values from JSON using JSONPath syntax. Supports the common subset: $.a.b, $.items[0], $.items[*].price, $..recursive, $["quoted key"]. Pairs with json-flatten for tabular pulls.',
  category: 'inspect',
  keywords: ['json', 'jsonpath', 'query', 'extract', 'select', 'path'],

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

  defaults: defaultJsonPathParams,

  paramSchema: {
    expression: {
      type: 'string',
      label: 'JSONPath',
      help: '$.users[*].email, $..price, $.config["api-key"], etc.',
      placeholder: '$.items[*].price',
    },
    limit: {
      type: 'number',
      label: 'limit',
      help: '0 = no cap.',
      min: 0,
      max: 10000,
      step: 1,
    },
  },

  async run(inputs: File[], params: JsonPathParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('json-path accepts exactly one JSON input.');
    const expr = (params.expression ?? '').trim();
    if (!expr) throw new Error('json-path requires an expression.');
    const limit = params.limit ?? 0;

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

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Evaluating path' });
    const matches = queryJsonPath(parsed, expr, limit);
    const result: JsonPathResult = {
      expression: expr,
      matchCount: matches.length,
      matches,
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
