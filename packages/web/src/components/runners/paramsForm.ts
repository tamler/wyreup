import type { ParamFieldSchema } from '@wyreup/core';

export function initialValueForSchema(schema: ParamFieldSchema): unknown {
  switch (schema.type) {
    case 'boolean':
      return false;
    case 'number':
      return schema.min ?? 0;
    case 'range':
      return schema.min;
    case 'enum':
      return schema.options[0]?.value ?? '';
    case 'multi-enum':
    case 'array':
      return [];
    case 'json':
      return {};
    case 'string':
      return '';
  }
}

export function buildInitialParams(
  defaults: Record<string, unknown>,
  paramSchema: Record<string, ParamFieldSchema> | undefined,
): Record<string, unknown> {
  const initial = { ...defaults };
  for (const [key, schema] of Object.entries(paramSchema ?? {})) {
    if (!(key in initial)) initial[key] = initialValueForSchema(schema);
  }
  return initial;
}

export function buildParamEntries(
  defaults: Record<string, unknown>,
  paramSchema: Record<string, ParamFieldSchema> | undefined,
): Array<[string, unknown]> {
  return Object.entries(buildInitialParams(defaults, paramSchema));
}
