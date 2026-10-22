import type {
  ParamFieldSchema,
  Surface,
  ToolCategory,
  ToolModule,
  ToolRunContext,
  ToolSeoContent,
} from '../types.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type UtilityParams = Record<string, unknown>;
export type UtilityResult = Record<string, JsonValue>;
export type UtilityErrorCode =
  | 'schema'
  | 'required'
  | 'type'
  | 'unknown'
  | 'enum'
  | 'bounds'
  | 'integer'
  | 'budget'
  | 'depth'
  | 'cycle'
  | 'prototype'
  | 'abort';

export class UtilityInputError extends Error {
  constructor(
    public readonly field: string,
    public readonly code: UtilityErrorCode,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = 'UtilityInputError';
  }
}

export interface UtilityDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  keywords: string[];
  defaults: UtilityParams;
  paramSchema: Record<string, ParamFieldSchema>;
  calculate: (params: UtilityParams, ctx: ToolRunContext) => UtilityResult | Promise<UtilityResult>;
  seoContent?: ToolSeoContent;
  surfaces?: Surface[];
}

const MAX_BYTES = 1048576;
const MAX_STRING = 100000;
const MAX_NUMBER = 1e12;
const encoder = new TextEncoder();

function fail(field: string, code: UtilityErrorCode, message: string): never {
  throw new UtilityInputError(field, code, message);
}

function record(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'type', 'Expected an object.');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    fail(path, 'prototype', 'Expected a plain object.');
}

export function cloneUtilityJson(value: unknown, path = '$'): JsonValue {
  let leaves = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const addBytes = (n: number) => {
    bytes += n;
    if (bytes > MAX_BYTES) fail(path, 'budget', 'JSON exceeds 1 MiB.');
  };
  const walk = (current: unknown, field: string, depth: number): JsonValue => {
    if (depth > 20) fail(field, 'depth', 'JSON nesting exceeds 20 levels.');
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean' ||
      typeof current === 'number'
    ) {
      if (typeof current === 'number' && !Number.isFinite(current))
        fail(field, 'bounds', 'Numbers must be finite.');
      if (++leaves > 20000) fail(field, 'budget', 'JSON exceeds 20,000 scalar values.');
      addBytes(encoder.encode(JSON.stringify(current)).byteLength);
      return current;
    }
    if (typeof current !== 'object') fail(field, 'type', 'Value is not JSON data.');
    if (current instanceof Number || current instanceof Boolean || current instanceof String)
      fail(field, 'type', 'Boxed primitives are not JSON data.');
    if (ancestors.has(current)) fail(field, 'cycle', 'Cyclic JSON is not supported.');
    const array = Array.isArray(current);
    if (array) {
      const prototype: unknown = Object.getPrototypeOf(current);
      if (prototype !== Array.prototype) fail(field, 'prototype', 'Expected a built-in array.');
    } else record(current, field);
    ancestors.add(current);
    try {
      addBytes(2);
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key === 'symbol'))
        fail(field, 'type', 'Symbol keys are not JSON data.');
      if (array) {
        if (keys.length !== current.length + 1)
          fail(field, 'prototype', 'Arrays must be dense with no extra properties.');
        const output: JsonValue[] = [];
        for (let i = 0; i < current.length; i++) {
          const property = Object.getOwnPropertyDescriptor(current, String(i));
          if (!property || !('value' in property) || !property.enumerable)
            fail(`${field}[${i}]`, 'prototype', 'Array holes and accessors are not supported.');
          if (i) addBytes(1);
          output.push(walk(property.value, `${field}[${i}]`, depth + 1));
        }
        return output;
      }
      const output = Object.create(null) as Record<string, JsonValue>;
      let index = 0;
      for (const key of keys as string[]) {
        const property = Object.getOwnPropertyDescriptor(current, key)!;
        if (!('value' in property) || !property.enumerable)
          fail(`${field}.${key}`, 'prototype', 'Only enumerable data properties are supported.');
        if (index++) addBytes(1);
        addBytes(encoder.encode(JSON.stringify(key)).byteLength + 1);
        output[key] = walk(property.value, `${field}.${key}`, depth + 1);
      }
      return output;
    } finally {
      ancestors.delete(current);
    }
  };
  const output = walk(value, path, 0);
  if (encoder.encode(JSON.stringify(output)).byteLength > MAX_BYTES)
    fail(path, 'budget', 'JSON exceeds 1 MiB.');
  return output;
}

export function utilityFieldVisible(schema: ParamFieldSchema, params: UtilityParams): boolean {
  const condition = schema.showWhen;
  if (!condition) return true;
  const value = params[condition.field];
  if (Object.hasOwn(condition, 'equals')) return value === condition.equals;
  return condition.in?.some((item) => item === value) ?? false;
}

type EnumSchema = Extract<ParamFieldSchema, { type: 'enum' }>;
export function utilityFieldOptions(
  schema: EnumSchema,
  params: UtilityParams,
): EnumSchema['options'] {
  const source = schema.optionsFrom;
  if (!source) return schema.options;
  const key = String(params[source.field]);
  return Object.hasOwn(source.map, key) ? source.map[key]! : schema.options;
}

export function utilityDependencyOrder(schema: Record<string, ParamFieldSchema>): string[] {
  const ordered: string[] = [];
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (key: string) => {
    if (complete.has(key)) return;
    if (active.has(key)) fail(key, 'cycle', 'Field dependencies contain a cycle.');
    active.add(key);
    const field = schema[key]!;
    const dependencies = [
      field.showWhen?.field,
      field.type === 'enum' ? field.optionsFrom?.field : undefined,
    ];
    for (const dependency of dependencies) {
      if (dependency === undefined) continue;
      if (!Object.hasOwn(schema, dependency))
        fail(key, 'schema', `Unknown dependency ${dependency}.`);
      visit(dependency);
    }
    active.delete(key);
    complete.add(key);
    ordered.push(key);
  };
  Object.keys(schema).forEach(visit);
  return ordered;
}

export function numberParam(
  params: UtilityParams,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const value = params[key];
  if (value === null || value === undefined) fail(key, 'required', 'Enter a number.');
  if (typeof value !== 'number') fail(key, 'type', 'Expected a number.');
  if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMBER)
    fail(key, 'bounds', 'Enter a finite number with absolute value at most 1e12.');
  if (options.min !== undefined && value < options.min)
    fail(key, 'bounds', `Minimum is ${options.min}.`);
  if (options.max !== undefined && value > options.max)
    fail(key, 'bounds', `Maximum is ${options.max}.`);
  if (options.integer && !Number.isInteger(value)) fail(key, 'integer', 'Enter a whole number.');
  return value;
}

export function stringParam(
  params: UtilityParams,
  key: string,
  options: { maxLength?: number } = {},
): string {
  const value = params[key];
  if (value === null || value === undefined) fail(key, 'required', 'Enter text.');
  if (typeof value !== 'string') fail(key, 'type', 'Expected text.');
  if (value.length > Math.min(options.maxLength ?? MAX_STRING, MAX_STRING))
    fail(key, 'budget', 'Text is too long.');
  return value;
}

function validateField(
  key: string,
  field: ParamFieldSchema,
  value: unknown,
  params: UtilityParams,
  required: boolean,
): void {
  if (value === null && required) fail(key, 'required', 'Enter a value.');
  switch (field.type) {
    case 'number':
    case 'range': {
      const step = field.step ?? (field.type === 'range' ? 1 : undefined);
      const n = numberParam(params, key, {
        min: field.min,
        max: field.max,
        integer: step !== undefined && Number.isInteger(step),
      });
      if (
        step !== undefined &&
        Number.isInteger(step) &&
        step > 1 &&
        Number.isInteger(field.min) &&
        (n - field.min!) % step !== 0
      )
        fail(key, 'integer', `Enter steps of ${step} from ${field.min}.`);
      break;
    }
    case 'string': {
      const text = stringParam(params, key, { maxLength: field.maxLength });
      if (text.length < (field.minLength ?? 0))
        fail(key, 'bounds', `Enter at least ${field.minLength} characters.`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail(key, 'type', 'Expected true or false.');
      break;
    case 'enum':
      if (value === null) fail(key, 'required', 'Choose an option.');
      if (!utilityFieldOptions(field, params).some((option) => option.value === value))
        fail(key, 'enum', 'Choose a supported option.');
      break;
    case 'multi-enum':
      if (!Array.isArray(value)) fail(key, 'type', 'Expected a list of choices.');
      if (value.length > 1000) fail(key, 'budget', 'Too many choices.');
      if (
        new Set(value).size !== value.length ||
        value.some(
          (item) =>
            typeof item !== 'string' || !field.options.some((option) => option.value === item),
        )
      )
        fail(key, 'enum', 'Choose unique supported options.');
      break;
    case 'array':
      if (!Array.isArray(value)) fail(key, 'type', 'Expected a list.');
      if (value.length > 1000) fail(key, 'budget', 'Lists have at most 1,000 items.');
      value.forEach((item: unknown, i) => {
        const itemParams = { [key]: item };
        if (field.itemType === 'number') numberParam(itemParams, key);
        else stringParam(itemParams, key);
        if (typeof item !== field.itemType) fail(`${key}[${i}]`, 'type', 'Wrong list item type.');
      });
      break;
    case 'json':
      break;
  }
}

function validateSchema(defaults: UtilityParams, schema: Record<string, ParamFieldSchema>): void {
  record(defaults, '$defaults');
  record(schema, '$schema');
  const keys = Object.keys(defaults);
  if (keys.length !== Object.keys(schema).length || keys.some((key) => !Object.hasOwn(schema, key)))
    fail('$schema', 'schema', 'Defaults and schema must have identical fields.');
  for (const key of keys) {
    const field = schema[key]!;
    if (
      !field ||
      typeof field !== 'object' ||
      !['number', 'range', 'string', 'boolean', 'enum', 'multi-enum', 'array', 'json'].includes(
        field.type,
      )
    )
      fail(key, 'schema', 'Invalid field schema.');
    if (field.showWhen) {
      const condition = field.showWhen;
      if (
        typeof condition.field !== 'string' ||
        (!Object.hasOwn(condition, 'equals') && !Array.isArray(condition.in))
      )
        fail(key, 'schema', 'Invalid visibility condition.');
      const values = Object.hasOwn(condition, 'equals') ? [condition.equals] : condition.in!;
      if (
        values.some(
          (value) =>
            !['string', 'number', 'boolean'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isFinite(value)),
        )
      )
        fail(key, 'schema', 'Invalid condition value.');
    }
    if (field.type === 'number' || field.type === 'range') {
      for (const bound of [field.min, field.max])
        if (bound !== undefined && (!Number.isFinite(bound) || Math.abs(bound) > MAX_NUMBER))
          fail(key, 'schema', 'Invalid numeric bounds.');
      if (field.min !== undefined && field.max !== undefined && field.min > field.max)
        fail(key, 'schema', 'Minimum exceeds maximum.');
      if (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0))
        fail(key, 'schema', 'Step must be finite and positive.');
      if (field.type === 'range' && (field.min === undefined || field.max === undefined))
        fail(key, 'schema', 'Range requires bounds.');
    }
    if (field.type === 'string') {
      for (const length of [field.minLength, field.maxLength])
        if (
          length !== undefined &&
          (!Number.isInteger(length) || length < 0 || length > MAX_STRING)
        )
          fail(key, 'schema', 'Invalid text length bound.');
      if ((field.minLength ?? 0) > (field.maxLength ?? MAX_STRING))
        fail(key, 'schema', 'Minimum text length exceeds maximum.');
    }
    if (field.type === 'enum' || field.type === 'multi-enum') {
      const validateOptions = (options: Array<{ value: string | number; label: string }>) => {
        if (!Array.isArray(options) || options.length === 0 || options.length > 1000)
          fail(key, 'schema', 'Provide 1 to 1,000 options.');
        const seen = new Set<string | number>();
        for (const option of options) {
          if (
            !option ||
            typeof option.label !== 'string' ||
            !['string', 'number'].includes(typeof option.value) ||
            (typeof option.value === 'number' &&
              (!Number.isFinite(option.value) || Math.abs(option.value) > MAX_NUMBER)) ||
            seen.has(option.value)
          )
            fail(key, 'schema', 'Options must have unique supported values and text labels.');
          if (field.type === 'multi-enum' && typeof option.value !== 'string')
            fail(key, 'schema', 'Multi-select values must be strings.');
          seen.add(option.value);
        }
      };
      validateOptions(field.options);
      if (field.type === 'enum' && field.optionsFrom) {
        record(field.optionsFrom.map, key);
        Object.values(field.optionsFrom.map).forEach(validateOptions);
      }
    }
    if (field.type === 'array' && !['string', 'number'].includes(field.itemType))
      fail(key, 'schema', 'Invalid array item type.');
    if (defaults[key] === null) {
      if (field.type === 'boolean' || field.type === 'range')
        fail(key, 'schema', 'Boolean and range defaults cannot be null.');
    } else {
      validateField(key, field, defaults[key], defaults, false);
    }
  }
  utilityDependencyOrder(schema);
}

export function validateUtilityParams(
  defaults: UtilityParams,
  schema: Record<string, ParamFieldSchema>,
  provided: UtilityParams,
): UtilityParams {
  record(provided, '$');
  const caller = cloneUtilityJson(provided, '$') as UtilityParams;
  const merged = cloneUtilityJson(defaults, '$defaults') as UtilityParams;
  for (const key of Object.keys(caller)) {
    if (!Object.hasOwn(schema, key)) fail(key, 'unknown', 'Unknown parameter.');
    merged[key] = caller[key];
  }
  const copied = cloneUtilityJson(merged, '$') as UtilityParams;
  const active = Object.create(null) as UtilityParams;
  for (const key of Object.keys(schema)) {
    const field = schema[key]!;
    if (!utilityFieldVisible(field, copied)) continue;
    validateField(key, field, copied[key], copied, defaults[key] === null);
    active[key] = copied[key];
  }
  return active;
}

async function calculateWithAbort(
  definition: UtilityDefinition,
  params: UtilityParams,
  ctx: ToolRunContext,
): Promise<UtilityResult> {
  if (ctx.signal.aborted) fail('$run', 'abort', 'Calculation cancelled.');
  let onAbort: (() => void) | undefined;
  const validatedResult = (value: unknown): UtilityResult => {
    record(value, '$result');
    return cloneUtilityJson(value, '$result') as UtilityResult;
  };
  try {
    const calculated = definition.calculate(params, ctx);
    if (ctx.signal.aborted) {
      if (
        calculated !== null &&
        typeof calculated === 'object' &&
        Object.getPrototypeOf(calculated) === Promise.prototype &&
        !Object.getOwnPropertyDescriptor(calculated, 'constructor')
      ) {
        void Promise.prototype.then.call(
          calculated,
          () => undefined,
          () => undefined,
        );
      }
      fail('$run', 'abort', 'Calculation cancelled.');
    }
    if (
      calculated === null ||
      typeof calculated !== 'object' ||
      Object.getPrototypeOf(calculated) !== Promise.prototype
    ) {
      return validatedResult(calculated);
    }
    for (const key of ['then', 'constructor']) {
      if (Object.getOwnPropertyDescriptor(calculated, key)) {
        fail(`$result.${key}`, 'prototype', 'Promise output hooks are unsupported.');
      }
    }
    // Clone fulfillment before any Promise resolution can assimilate the raw record.
    const validated = Promise.prototype.then.call(
      calculated,
      validatedResult,
    ) as Promise<UtilityResult>;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new UtilityInputError('$run', 'abort', 'Calculation cancelled.'));
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([validated, cancelled]);
  } catch (error) {
    if (error instanceof UtilityInputError) throw error;
    if (ctx.signal.aborted) fail('$run', 'abort', 'Calculation cancelled.');
    throw error;
  } finally {
    if (onAbort) ctx.signal.removeEventListener('abort', onAbort);
  }
}

export function createUtility(definition: UtilityDefinition): ToolModule<UtilityParams> {
  const defaults = cloneUtilityJson(definition.defaults, '$defaults') as UtilityParams;
  validateSchema(defaults, definition.paramSchema);
  return {
    id: definition.id,
    slug: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    keywords: [...definition.keywords],
    input: { accept: [], min: 0, max: 0 },
    output: { mime: 'application/json', multiple: false },
    interactive: false,
    batchable: false,
    cost: 'free',
    memoryEstimate: 'low',
    defaults: cloneUtilityJson(defaults) as UtilityParams,
    paramSchema: definition.paramSchema,
    ...(definition.seoContent ? { seoContent: definition.seoContent } : {}),
    ...(definition.surfaces ? { surfaces: [...definition.surfaces] } : {}),
    async run(inputs, provided, ctx) {
      if (inputs.length) fail('$inputs', 'schema', 'This calculator does not accept files.');
      const params = validateUtilityParams(defaults, definition.paramSchema, provided);
      const calculated = await calculateWithAbort(definition, params, ctx);
      if (ctx.signal.aborted) fail('$run', 'abort', 'Calculation cancelled.');
      record(calculated, '$result');
      const output = cloneUtilityJson(calculated, '$result');
      if (ctx.signal.aborted) fail('$run', 'abort', 'Calculation cancelled.');
      ctx.onProgress({ stage: 'done', percent: 100 });
      return [new Blob([JSON.stringify(output)], { type: 'application/json' })];
    },
    __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
  };
}
