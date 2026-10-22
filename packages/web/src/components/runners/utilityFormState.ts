import {
  cloneUtilityJson,
  utilityDependencyOrder,
  utilityFieldOptions,
  utilityFieldVisible,
  validateUtilityParams,
  UtilityInputError,
  type ParamFieldSchema,
} from '@wyreup/core/execution';

export type UtilitySchema = Record<string, ParamFieldSchema>;

export function changeUtilityField(
  schema: UtilitySchema,
  params: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...params, [key]: value };
  for (const dependent of utilityDependencyOrder(schema)) {
    const field = schema[dependent];
    if (dependent === key || field.type !== 'enum' || !field.optionsFrom) continue;
    if (!utilityFieldOptions(field, next).some((option) => option.value === next[dependent]))
      next[dependent] = null;
  }
  return next;
}

export function utilityEnumToken(
  field: Extract<ParamFieldSchema, { type: 'enum' }>,
  params: Record<string, unknown>,
  key: string,
): string {
  const index = utilityFieldOptions(field, params).findIndex(
    (option) => option.value === params[key],
  );
  return index < 0 ? '' : String(index);
}

export function utilityEnumValue(
  field: Extract<ParamFieldSchema, { type: 'enum' }>,
  params: Record<string, unknown>,
  token: string,
): string | number | null {
  if (!/^(0|[1-9]\d*)$/.test(token)) return null;
  return utilityFieldOptions(field, params)[Number(token)]?.value ?? null;
}

export function parseUtilityArray(raw: string, itemType: 'number' | 'string'): unknown[] {
  if (!raw.trim()) return [];
  const items = raw.split(',').map((item) => item.trim());
  if (itemType === 'string') return items;
  if (items.some((item) => item === '' || !Number.isFinite(Number(item))))
    throw new Error('Enter a comma-separated list of numbers.');
  return items.map(Number);
}

export function utilityFormErrors(
  defaults: Record<string, unknown>,
  schema: UtilitySchema,
  params: Record<string, unknown>,
  parseErrors: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, message] of Object.entries(parseErrors)) {
    if (message && utilityFieldVisible(schema[key], params)) errors[key] = message;
  }
  try {
    validateUtilityParams(defaults, schema, params);
  } catch (error) {
    if (error instanceof UtilityInputError) {
      const key = Object.keys(schema).find((key) =>
        error.field === key || error.field === `$.${key}` ||
        error.field.startsWith(`$.${key}.`) || error.field.startsWith(`$.${key}[`),
      );
      errors[key && utilityFieldVisible(schema[key], params) ? key : '$form'] = error.message;
    }
    else errors.$form = 'Check the input values.';
  }
  return errors;
}

export function initialUtilityParams(defaults: Record<string, unknown>): Record<string, unknown> {
  return cloneUtilityJson(defaults) as Record<string, unknown>;
}
