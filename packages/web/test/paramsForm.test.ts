import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, type ParamFieldSchema } from '@wyreup/core';
import { buildInitialParams, buildParamEntries } from '../src/components/runners/paramsForm.js';

describe('ParamsForm field discovery', () => {
  it('includes schema-only fields and gives them type-appropriate initial values', () => {
    const initial = buildInitialParams(
      { armor: true },
      {
        armor: { type: 'boolean' },
        passphrase: { type: 'string' },
        count: { type: 'number', min: 2 },
        formats: { type: 'multi-enum', options: [] },
      },
    );

    expect(initial).toEqual({ armor: true, passphrase: '', count: 2, formats: [] });
  });

  it('renders every declared schema field for every registered tool', () => {
    for (const tool of createDefaultRegistry().tools) {
      const renderedKeys = new Set(
        buildParamEntries(
          tool.defaults as Record<string, unknown>,
          tool.paramSchema,
        ).map(([key]) => key),
      );
      for (const key of Object.keys(tool.paramSchema ?? {})) {
        expect(renderedKeys.has(key), `${tool.id}.${key}`).toBe(true);
      }
    }
  });

  it('exposes optional PDF encryption controls and marks secret fields for masking', () => {
    const registry = createDefaultRegistry();
    const encrypt = registry.toolsById.get('pdf-encrypt')!;
    const initial = buildInitialParams(
      encrypt.defaults as Record<string, unknown>,
      encrypt.paramSchema,
    );
    const encryptSchema = encrypt.paramSchema as Record<string, ParamFieldSchema>;
    const strengthSchema = registry.toolsById.get('password-strength')?.paramSchema as Record<
      string,
      ParamFieldSchema
    >;

    expect(initial).toMatchObject({ userPassword: '', ownerPassword: '', permissions: {} });
    expect(encryptSchema.userPassword).toMatchObject({ secret: true });
    expect(encryptSchema.ownerPassword).toMatchObject({ secret: true });
    expect(strengthSchema.password).toMatchObject({ secret: true });
  });
});
