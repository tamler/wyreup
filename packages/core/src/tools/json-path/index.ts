import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonPathParams {
  /** Bounded subset: dot names/wildcards, integer indices, quoted names, recursive names/wildcards. */
  expression?: string;
  /** Matches returned, 0 means all within the declared hard bounds. */
  limit?: number;
}

export const defaultJsonPathParams: JsonPathParams = { expression: '$', limit: 0 };

export interface JsonPathMatch {
  path: string;
  value: unknown;
}

export interface JsonPathResult {
  expression: string;
  matchCount: number;
  totalMatchCount: number;
  truncated: boolean;
  matches: JsonPathMatch[];
}

type QueryContext = Pick<ToolRunContext, 'signal'>;
type Selector =
  { kind: 'name'; name: string } | { kind: 'index'; index: number } | { kind: 'wildcard' };
type Step = Selector | { kind: 'recursive'; selector: Selector };
interface Container {
  array: boolean;
  children: Array<{ segment: string | number; value: unknown }>;
  properties: Record<string, unknown>;
}
interface Work {
  visits: number;
  pathWork: number;
}
const MAX_DEPTH = 128;
const MAX_NODES = 100000;
const MAX_VISITS = 1000000;
const MAX_MATCHES = 10000;
const MAX_EXPRESSION = 4096;
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_PATH_CHARS = 20 * 1024 * 1024;
const MAX_PATH_WORK = 256 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function check(ctx?: QueryContext): void {
  if (ctx?.signal.aborted) throw new Error('JSONPath calculation cancelled.');
}
function visit(work: Work, ctx?: QueryContext): void {
  check(ctx);
  if (++work.visits > MAX_VISITS) throw new Error('JSONPath traversal exceeds 1000000 visits.');
}
function validLimit(limit: unknown): asserts limit is number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > MAX_MATCHES)
    throw new Error('JSONPath limit must be an integer from 0 to 10000.');
}
function tokenize(expression: unknown): { expression: string; steps: Step[] } {
  if (typeof expression !== 'string' || expression.length > MAX_EXPRESSION)
    throw new Error('JSONPath expression must be a string of at most 4096 characters.');
  const expr = expression.trim();
  if (!expr.startsWith('$')) throw new Error('JSONPath expression must start with $.');
  let i = 1;
  const steps: Step[] = [];
  function spaces() {
    while (i < expr.length && /[ \t\r\n]/.test(expr[i]!)) i++;
  }
  function name(): Selector {
    if (expr[i] === '*') {
      i++;
      return { kind: 'wildcard' };
    }
    const start = i;
    if (!/[A-Za-z_]/.test(expr[i] ?? ''))
      throw new Error('Expected a JSONPath name or wildcard at position ' + i + '.');
    i++;
    while (i < expr.length && /[A-Za-z0-9_-]/.test(expr[i]!)) i++;
    return { kind: 'name', name: expr.slice(start, i) };
  }
  function bracket(): Selector {
    i++;
    spaces();
    const quote = expr[i];
    let selector: Selector;
    if (quote === '"' || quote === "'") {
      const start = i++;
      let closed = false;
      let single = '';
      while (i < expr.length) {
        const ch = expr[i++]!;
        if (ch === quote) {
          closed = true;
          break;
        }
        if (ch.charCodeAt(0) < 32)
          throw new Error('Raw controls are not allowed in quoted JSONPath names.');
        if (ch === '\\') {
          if (i >= expr.length) throw new Error('Unterminated quoted JSONPath name.');
          const escaped = expr[i++]!;
          if (quote === "'" && escaped !== "'" && escaped !== '\\')
            throw new Error(
              'Single-quoted JSONPath names support only escaped quote or backslash.',
            );
          if (quote === "'") single += escaped;
        } else if (quote === "'") single += ch;
      }
      if (!closed) throw new Error('Unterminated quoted JSONPath name.');
      let property: unknown;
      try {
        property = quote === '"' ? JSON.parse(expr.slice(start, i)) : single;
      } catch {
        throw new Error('Invalid JSON escapes in quoted JSONPath name.');
      }
      if (typeof property !== 'string') throw new Error('Expected a quoted JSONPath name.');
      selector = { kind: 'name', name: property };
      spaces();
    } else {
      const start = i;
      while (i < expr.length && expr[i] !== ']') i++;
      const body = expr.slice(start, i).trim();
      if (body === '*') selector = { kind: 'wildcard' };
      else if (/^-?\d+$/.test(body)) {
        const index = Number(body);
        if (!Number.isSafeInteger(index)) throw new Error('JSONPath index must be a safe integer.');
        selector = { kind: 'index', index };
      } else throw new Error('Unsupported JSONPath bracket selector: [' + body + '].');
    }
    if (expr[i] !== ']') throw new Error('Unterminated or malformed JSONPath bracket selector.');
    i++;
    return selector;
  }
  while (i < expr.length) {
    if (expr[i] === '.') {
      i++;
      if (expr[i] === '.') {
        i++;
        const selector = expr[i] === '[' ? bracket() : name();
        if (selector.kind === 'index' || (expr[i - 1] === ']' && selector.kind !== 'name'))
          throw new Error('Recursive bracket selectors must be quoted property names.');
        steps.push({ kind: 'recursive', selector });
      } else steps.push(name());
    } else if (expr[i] === '[') steps.push(bracket());
    else throw new Error('Unexpected JSONPath character at position ' + i + '.');
  }
  return { expression: expr, steps };
}

function validateInput(value: unknown, ctx?: QueryContext): WeakMap<object, Container> {
  const containers = new WeakMap<object, Container>();
  const active = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; leave?: boolean }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    check(ctx);
    const item = stack.pop()!;
    if (item.leave) {
      active.delete(item.value as object);
      continue;
    }
    if (item.depth > MAX_DEPTH) throw new Error('JSONPath input depth exceeds 128.');
    if (++nodes > MAX_NODES) throw new Error('JSONPath input exceeds 100000 nodes.');
    const node = item.value;
    if (node === null || typeof node === 'string' || typeof node === 'boolean') continue;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new Error('JSONPath input numbers must be finite.');
      continue;
    }
    if (typeof node !== 'object') throw new Error('JSONPath input must contain only JSON values.');
    if (active.has(node)) throw new Error('JSONPath input contains a cycle.');
    const array = Array.isArray(node);
    const prototype: unknown = Object.getPrototypeOf(node);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null)
      throw new Error('JSONPath input containers must be plain objects or arrays.');
    if (Object.getOwnPropertySymbols(node).length)
      throw new Error('JSONPath input cannot contain symbol properties.');
    let container = containers.get(node);
    if (!container) {
      if (array && node.length > MAX_NODES - 1)
        throw new Error('JSONPath input exceeds 100000 nodes.');
      const descriptors = Object.getOwnPropertyDescriptors(node);
      const keys = Object.keys(descriptors).filter((key) => !array || key !== 'length');
      if (keys.length > MAX_NODES - nodes) throw new Error('JSONPath input exceeds 100000 nodes.');
      if (
        array &&
        (keys.length !== node.length || keys.some((key, index) => key !== String(index)))
      )
        throw new Error('JSONPath arrays must be dense and have only own integer elements.');
      container = {
        array,
        children: [],
        properties: Object.create(null) as Record<string, unknown>,
      };
      for (const key of keys) {
        const descriptor = descriptors[key]!;
        if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
          throw new Error(
            'JSONPath input must contain enumerable data properties, never accessors.',
          );
        const child: unknown = descriptor.value;
        Object.defineProperty(container.properties, key, { value: child, enumerable: true });
        container.children.push({ segment: array ? Number(key) : key, value: child });
      }
      containers.set(node, container);
    }
    active.add(node);
    stack.push({ value: node, depth: item.depth, leave: true });
    for (let index = container.children.length - 1; index >= 0; index--)
      stack.push({ value: container.children[index]!.value, depth: item.depth + 1 });
  }
  return containers;
}

// Exact JSON string byte count, without constructing a possibly oversized escaped string.
function quotedBytes(value: string, available: number, ctx?: QueryContext): number {
  let bytes = 2;
  for (let i = 0; i < value.length; i++) {
    if ((i & 1023) === 0) check(ctx);
    const code = value.charCodeAt(i);
    if (
      code === 34 ||
      code === 92 ||
      code === 8 ||
      code === 9 ||
      code === 10 ||
      code === 12 ||
      code === 13
    )
      bytes += 2;
    else if (code < 32) bytes += 6;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
    if (bytes > available)
      throw new Error('JSONPath output or canonical path exceeds its 20 MiB budget.');
  }
  if (bytes > available)
    throw new Error('JSONPath output or canonical path exceeds its 20 MiB budget.');
  return bytes;
}
function joinPath(
  prefix: string,
  segment: string | number,
  work: Work,
  ctx?: QueryContext,
): string {
  check(ctx);
  work.pathWork += prefix.length + 8 * String(segment).length + 4;
  if (work.pathWork > MAX_PATH_WORK)
    throw new Error(
      'JSONPath path work exceeds 256 Mi weighted character units. Reduce long prefixes or repeated recursive traversal.',
    );
  if (typeof segment === 'number') return prefix + '[' + segment + ']';
  if (prefix.length + segment.length + 1 > MAX_PATH_CHARS)
    throw new Error('JSONPath canonical path exceeds 20 MiB characters.');
  const suffix = IDENTIFIER.test(segment)
    ? '.' + segment
    : '[' +
      (quotedBytes(segment, MAX_PATH_CHARS - prefix.length - 2, ctx), JSON.stringify(segment)) +
      ']';
  if (prefix.length + suffix.length > MAX_PATH_CHARS)
    throw new Error('JSONPath canonical path exceeds 20 MiB characters.');
  return prefix + suffix;
}
function evaluate(
  value: unknown,
  expr: unknown,
  ctx?: QueryContext,
): { expression: string; matches: JsonPathMatch[] } {
  check(ctx);
  const parsed = tokenize(expr);
  const containers = validateInput(value, ctx);
  const work: Work = { visits: 0, pathWork: 0 };
  let current: JsonPathMatch[] = [{ path: '$', value }];
  for (const step of parsed.steps) {
    const next: JsonPathMatch[] = [];
    let pathChars = 0;
    function append(match: JsonPathMatch) {
      if (next.length >= MAX_MATCHES)
        throw new Error('JSONPath intermediate matches exceed 10000.');
      pathChars += match.path.length;
      if (pathChars > MAX_PATH_CHARS)
        throw new Error('JSONPath intermediate canonical paths exceed 20 MiB characters.');
      next.push(match);
    }
    for (const match of current) {
      visit(work, ctx);
      if (step.kind === 'recursive') {
        const pending: Array<{ match: JsonPathMatch; index: number; entered: boolean }> = [
          { match, index: 0, entered: false },
        ];
        while (pending.length) {
          const frame = pending[pending.length - 1]!;
          const descendant = frame.match;
          const container =
            descendant.value !== null && typeof descendant.value === 'object'
              ? containers.get(descendant.value)
              : undefined;
          if (!frame.entered) {
            visit(work, ctx);
            if (step.selector.kind === 'wildcard' && pending.length > 1) append(descendant);
            else if (
              step.selector.kind === 'name' &&
              container &&
              !container.array &&
              Object.hasOwn(container.properties, step.selector.name)
            )
              append({
                path: joinPath(descendant.path, step.selector.name, work, ctx),
                value: container.properties[step.selector.name],
              });
            frame.entered = true;
          }
          if (!container || frame.index >= container.children.length) {
            pending.pop();
            continue;
          }
          const child = container.children[frame.index++]!;
          pending.push({
            match: {
              path: joinPath(descendant.path, child.segment, work, ctx),
              value: child.value,
            },
            index: 0,
            entered: false,
          });
        }
      } else {
        const container =
          match.value !== null && typeof match.value === 'object'
            ? containers.get(match.value)
            : undefined;
        if (!container) continue;
        if (step.kind === 'wildcard') {
          for (const child of container.children) {
            visit(work, ctx);
            append({ path: joinPath(match.path, child.segment, work, ctx), value: child.value });
          }
        } else if (step.kind === 'index' && container.array) {
          const index = step.index < 0 ? container.children.length + step.index : step.index;
          if (Object.hasOwn(container.properties, String(index)))
            append({
              path: joinPath(match.path, index, work, ctx),
              value: container.properties[String(index)],
            });
        } else if (
          step.kind === 'name' &&
          !container.array &&
          Object.hasOwn(container.properties, step.name)
        )
          append({
            path: joinPath(match.path, step.name, work, ctx),
            value: container.properties[step.name],
          });
      }
    }
    current = next;
    if (!current.length) break;
  }
  check(ctx);
  return { expression: parsed.expression, matches: current };
}

/** Query inert plain JSON data; this is not a sandbox for caller-supplied executable objects or Proxies. */
export function queryJsonPath(
  value: unknown,
  expression: string,
  limit = 0,
  ctx?: QueryContext,
): JsonPathMatch[] {
  validLimit(limit);
  const matches = evaluate(value, expression, ctx).matches;
  return limit > 0 ? matches.slice(0, limit) : matches;
}

function parameters(params: unknown): { expression: string; limit: number } {
  if (
    !params ||
    typeof params !== 'object' ||
    Array.isArray(params) ||
    (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null)
  )
    throw new Error('JSONPath parameters must be a plain object.');
  const descriptors = Object.getOwnPropertyDescriptors(params);
  if (Object.getOwnPropertySymbols(params).length) throw new Error('Unknown JSONPath parameter.');
  for (const [key, descriptor] of Object.entries(descriptors))
    if (
      !['expression', 'limit'].includes(key) ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable
    )
      throw new Error('Unknown or accessor JSONPath parameter: ' + key + '.');
  const expression: unknown = Object.hasOwn(descriptors, 'expression')
    ? descriptors.expression!.value
    : '$';
  const limit: unknown = Object.hasOwn(descriptors, 'limit') ? descriptors.limit!.value : 0;
  validLimit(limit);
  return { expression: tokenize(expression).expression, limit };
}

function boundedJson(result: JsonPathResult, ctx?: QueryContext): string {
  let bytes = 0;
  let visits = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: result, depth: 0 }];
  function add(amount: number) {
    bytes += amount;
    if (bytes > MAX_OUTPUT_BYTES) throw new Error('JSONPath output exceeds 20 MiB.');
  }
  while (stack.length) {
    check(ctx);
    if (++visits > MAX_VISITS)
      throw new Error('JSONPath output exceeds 1000000 serialization visits.');
    const item = stack.pop()!;
    const node = item.value;
    if (typeof node === 'string') {
      add(quotedBytes(node, MAX_OUTPUT_BYTES - bytes, ctx));
      continue;
    }
    if (node === null || typeof node !== 'object') {
      add(String(node).length);
      continue;
    }
    const entries: Array<[string, unknown]> = Array.isArray(node)
      ? node.map((child: unknown, index: number) => [String(index), child])
      : Object.entries(node);
    add(2);
    if (entries.length) {
      add(
        entries.length -
          1 +
          entries.length +
          1 +
          2 * (item.depth + 1) * entries.length +
          2 * item.depth,
      );
      for (const [key, child] of entries) {
        if (!Array.isArray(node)) {
          add(quotedBytes(key, MAX_OUTPUT_BYTES - bytes, ctx));
          add(2);
        }
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  check(ctx);
  const text = JSON.stringify(result, null, 2);
  check(ctx);
  return text;
}

export const jsonPath: ToolModule<JsonPathParams> = {
  id: 'json-path',
  slug: 'json-path',
  name: 'JSON Path',
  description:
    'Extract JSON values with a bounded JSONPath subset: dot names/wildcards, integer indices (including negative), quoted property names, and recursive names/wildcards. Long prefixes or repeated recursive traversal can exceed the cumulative path-work limit, including queries with no matches. No filters, scripts, slices or unions.',
  category: 'inspect',
  keywords: ['json', 'jsonpath', 'query', 'extract', 'select', 'path'],
  input: { accept: ['application/json', 'text/plain'], min: 1, max: 1, sizeLimit: MAX_INPUT_BYTES },
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
      help: '$.users[*].email, $..price, $.config["api-key"]. Root $ required; maximum 4096 characters.',
      placeholder: '$.items[*].price',
      minLength: 1,
      maxLength: MAX_EXPRESSION,
    },
    limit: {
      type: 'number',
      label: 'limit',
      help: '0 returns all within hard bounds: depth 128, 100000 input nodes, 1000000 traversal visits, 10000 intermediate matches, 20 MiB canonical path characters, 20 MiB output bytes and 256 Mi cumulative weighted path-work units.',
      min: 0,
      max: MAX_MATCHES,
      step: 1,
    },
  },
  async run(inputs: File[], params: JsonPathParams, ctx: ToolRunContext): Promise<Blob[]> {
    check(ctx);
    const normalized = parameters(params);
    if (!Array.isArray(inputs) || inputs.length !== 1 || !(inputs[0] instanceof File))
      throw new Error('json-path accepts exactly one JSON File input.');
    const file = inputs[0];
    if (!['', 'application/json', 'text/plain'].includes(file.type))
      throw new Error('json-path accepts JSON or plain-text files.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('JSONPath input exceeds 100 MiB.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing UTF-8 JSON' });
    check(ctx);
    const buffer = await file.arrayBuffer();
    check(ctx);
    if (buffer.byteLength > MAX_INPUT_BYTES) throw new Error('JSONPath input exceeds 100 MiB.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    } catch {
      throw new Error('Input must be valid UTF-8 JSON.');
    }
    check(ctx);
    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Evaluating bounded path' });
    check(ctx);
    const all = evaluate(parsed, normalized.expression, ctx);
    const matches = normalized.limit > 0 ? all.matches.slice(0, normalized.limit) : all.matches;
    const result: JsonPathResult = {
      expression: all.expression,
      matchCount: matches.length,
      totalMatchCount: all.matches.length,
      truncated: matches.length < all.matches.length,
      matches,
    };
    const text = boundedJson(result, ctx);
    check(ctx);
    const output = new Blob([text], { type: 'application/json' });
    if (output.size > MAX_OUTPUT_BYTES) throw new Error('JSONPath output exceeds 20 MiB.');
    check(ctx);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    check(ctx);
    return [output];
  },
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
