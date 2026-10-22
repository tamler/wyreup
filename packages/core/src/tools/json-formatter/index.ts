import type { ToolModule, ToolRunContext } from '../../types.js';
import type { JsonFormatterParams } from './types.js';
import { defaultJsonFormatterParams } from './types.js';
import { UtilityInputError, validateUtilityParams } from '../../utilities/common.js';

export type { JsonFormatterParams } from './types.js';
export { defaultJsonFormatterParams } from './types.js';

const schema = {
  indent: {
    type: 'range' as const,
    label: 'Indentation',
    min: 0,
    max: 8,
    step: 1,
    unit: ' spaces',
  },
  sortKeys: {
    type: 'boolean' as const,
    label: 'Sort object keys',
    help: 'Integer-index keys follow JSON numeric order; other keys are sorted lexically. Array order is preserved.',
  },
  validationOnly: { type: 'boolean' as const, label: 'Validate without formatting' },
};

const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

function quotedUtf8Bytes(value: string, signal?: AbortSignal): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    if ((index & 1023) === 0 && signal?.aborted)
      throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 6;
    } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
    if (bytes > MAX_OUTPUT_BYTES)
      throw new UtilityInputError('$result', 'budget', 'Formatted JSON output exceeds 50 MiB.');
  }
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
  return bytes;
}

function boundedJson(
  value: unknown,
  sort: boolean,
  signal?: AbortSignal,
  indent?: number,
): unknown {
  let nodes = 0;
  let outputBytes = 0;
  const addBytes = (bytes: number): void => {
    outputBytes += bytes;
    if (outputBytes > MAX_OUTPUT_BYTES)
      throw new UtilityInputError('$result', 'budget', 'Formatted JSON output exceeds 50 MiB.');
  };
  const containerBytes = (length: number, depth: number): void => {
    if (indent === undefined) return;
    addBytes(2 + Math.max(0, length - 1));
    if (length && indent > 0) addBytes(length + 1 + indent * ((depth + 1) * length + depth));
  };
  let result: unknown;
  const pending: { value: unknown; depth: number; set: (value: unknown) => void }[] = [
    {
      value,
      depth: 0,
      set: (value) => {
        result = value;
      },
    },
  ];
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 100000)
      throw new UtilityInputError('$input', 'budget', 'JSON exceeds 100,000 values.');
    if (current.depth > 128)
      throw new UtilityInputError('$input', 'depth', 'JSON nesting exceeds 128 levels.');
    if ((nodes & 1023) === 0 && signal?.aborted)
      throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
    if (current.value === null || typeof current.value !== 'object') {
      if (typeof current.value === 'number' && !Number.isFinite(current.value))
        throw new UtilityInputError('$input', 'bounds', 'JSON numbers must be finite.');
      if (indent !== undefined)
        addBytes(
          typeof current.value === 'string'
            ? quotedUtf8Bytes(current.value, signal)
            : String(current.value).length,
        );
      current.set(current.value);
      continue;
    }
    if (Array.isArray(current.value)) {
      const array = current.value;
      if (array.length > 100000 - nodes - pending.length)
        throw new UtilityInputError('$input', 'budget', 'JSON exceeds 100,000 values.');
      containerBytes(array.length, current.depth);
      const output: unknown[] = new Array(array.length);
      current.set(output);
      for (let index = array.length - 1; index >= 0; index--)
        pending.push({
          value: array[index],
          depth: current.depth + 1,
          set: (value) => {
            output[index] = value;
          },
        });
    } else {
      const object = current.value as Record<string, unknown>;
      const keys = Object.keys(object);
      if (keys.length > 100000 - nodes - pending.length)
        throw new UtilityInputError('$input', 'budget', 'JSON exceeds 100,000 values.');
      containerBytes(keys.length, current.depth);
      if (indent !== undefined)
        for (const key of keys) addBytes(quotedUtf8Bytes(key, signal) + 1 + (indent > 0 ? 1 : 0));
      if (sort) keys.sort();
      const output = Object.create(null) as Record<string, unknown>;
      current.set(output);
      for (const key of keys)
        Object.defineProperty(output, key, {
          value: null,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!;
        pending.push({
          value: object[key],
          depth: current.depth + 1,
          set: (value) => {
            output[key] = value;
          },
        });
      }
    }
    if (nodes + pending.length > 100000)
      throw new UtilityInputError('$input', 'budget', 'JSON exceeds 100,000 values.');
  }
  return result;
}

export function formatJsonText(
  text: string,
  params: JsonFormatterParams = {},
  signal?: AbortSignal,
): string {
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
  if (new TextEncoder().encode(text).length > 50 * 1024 * 1024)
    throw new UtilityInputError('$input', 'budget', 'JSON input exceeds 50 MiB.');
  const checked = validateUtilityParams(
    { ...defaultJsonFormatterParams },
    schema,
    params as Record<string, unknown>,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = `Invalid JSON: ${error instanceof Error ? error.message : 'Parsing failed.'}`;
    if (checked.validationOnly) return JSON.stringify({ valid: false, error: message });
    throw new Error(message);
  }
  const output = boundedJson(
    parsed,
    checked.sortKeys === true,
    signal,
    checked.validationOnly ? undefined : (checked.indent as number),
  );
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
  return checked.validationOnly
    ? JSON.stringify({ valid: true })
    : JSON.stringify(output, null, checked.indent as number);
}

export const jsonFormatter: ToolModule<JsonFormatterParams> = {
  id: 'json-formatter',
  slug: 'json-formatter',
  name: 'JSON Formatter',
  description:
    'Validate and format JSON with configurable indentation and optional stable object-key sorting. Array order is preserved. Input and formatted UTF-8 output are limited to 50 MiB; number normalization or indentation can make output larger than input. Nesting and value counts are bounded.',
  category: 'inspect',
  keywords: ['json', 'format', 'pretty', 'print', 'indent', 'beautify'],

  input: {
    accept: ['text/plain', 'application/json'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonFormatterParams,

  paramSchema: schema,

  async run(inputs: File[], params: JsonFormatterParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
    const file = inputs[0];
    if (
      inputs.length !== 1 ||
      !file ||
      !Number.isFinite(file.size) ||
      file.size < 0 ||
      typeof file.slice !== 'function'
    )
      throw new UtilityInputError('$input', 'type', 'Select exactly one JSON file.');
    const limit = 50 * 1024 * 1024;
    if (file.size > limit)
      throw new UtilityInputError('$input', 'budget', 'JSON input exceeds 50 MiB.');
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Parsing JSON' });
    const bytes = await file.slice(0, limit + 1).arrayBuffer();
    if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
    if (bytes.byteLength > limit)
      throw new UtilityInputError('$input', 'budget', 'JSON input exceeds 50 MiB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const formatted = formatJsonText(text, params, ctx.signal);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([formatted], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
