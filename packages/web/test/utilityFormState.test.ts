import { describe, expect, it } from 'vitest';
import type { ParamFieldSchema } from '@wyreup/core';
import {
  changeUtilityField,
  initialUtilityParams,
  parseUtilityArray,
  utilityEnumToken,
  utilityEnumValue,
  utilityFormErrors,
} from '../src/components/runners/utilityFormState';

describe('utility form state', () => {
  const typed: Extract<ParamFieldSchema, { type: 'enum' }> = {
    type: 'enum',
    options: [
      { value: 1, label: 'Number' },
      { value: '1', label: 'Text' },
      { value: '', label: 'Empty text' },
    ],
  };
  it('preserves typed options, empty-string option and placeholder', () => {
    expect(utilityEnumToken(typed, { value: 1 }, 'value')).toBe('0');
    expect(utilityEnumToken(typed, { value: '1' }, 'value')).toBe('1');
    expect(utilityEnumValue(typed, {}, '0')).toBe(1);
    expect(utilityEnumValue(typed, {}, '1')).toBe('1');
    expect(utilityEnumValue(typed, {}, '2')).toBe('');
    expect(utilityEnumValue(typed, {}, '')).toBeNull();
    expect(utilityEnumValue(typed, {}, '01')).toBeNull();
  });
  it('resets invalid dependent choices to null in dependency order', () => {
    const schema: Record<string, ParamFieldSchema> = {
      parent: {
        type: 'enum',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
      child: {
        type: 'enum',
        options: [{ value: 'x', label: 'X' }],
        optionsFrom: { field: 'parent', map: { b: [{ value: 'y', label: 'Y' }] } },
      },
      grandchild: {
        type: 'enum',
        options: [{ value: 'z', label: 'Z' }],
        optionsFrom: { field: 'child', map: { null: [{ value: 'w', label: 'W' }] } },
      },
    };
    const current = { parent: 'a', child: 'x', grandchild: 'z' };
    expect(changeUtilityField(schema, current, 'parent', 'b')).toEqual({
      parent: 'b',
      child: null,
      grandchild: null,
    });
    expect(current.child).toBe('x');
  });
  it('blocks blank required numbers but preserves zero and false', () => {
    const schema: Record<string, ParamFieldSchema> = {
      amount: { type: 'number', min: 0 },
      enabled: { type: 'boolean' },
    };
    expect(
      utilityFormErrors({ amount: null, enabled: true }, schema, { amount: 0, enabled: false }, {}),
    ).toEqual({});
    expect(
      utilityFormErrors(
        { amount: null, enabled: true },
        schema,
        { amount: null, enabled: false },
        {},
      ),
    ).toHaveProperty('amount');
  });
  it('blocks invalid JSON despite a retained parsed value; inactive errors do not block', () => {
    const schema: Record<string, ParamFieldSchema> = {
      enabled: { type: 'boolean' },
      data: { type: 'json', showWhen: { field: 'enabled', equals: true } },
    };
    expect(
      utilityFormErrors(
        { enabled: true, data: {} },
        schema,
        { enabled: true, data: { old: 1 } },
        { data: 'Invalid JSON' },
      ),
    ).toHaveProperty('data', 'Invalid JSON');
    expect(
      utilityFormErrors(
        { enabled: true, data: {} },
        schema,
        { enabled: false, data: { old: 1 } },
        { data: 'Invalid JSON' },
      ),
    ).toEqual({});
  });
  it('never silently drops invalid array entries', () => {
    expect(parseUtilityArray('0, 1.5, -2', 'number')).toEqual([0, 1.5, -2]);
    expect(() => parseUtilityArray('1,wrong,2', 'number')).toThrow();
    expect(() => parseUtilityArray('1,,2', 'number')).toThrow();
    expect(parseUtilityArray('', 'number')).toEqual([]);
  });
  it('maps sanitizer paths to a visible field or form error, including hidden invalid JSON', () => {
    const schema: Record<string, ParamFieldSchema> = {
      enabled: { type: 'boolean' },
      data: { type: 'json', showWhen: { field: 'enabled', equals: true } },
    };
    const defaults = { enabled: true, data: {} };
    const params = { enabled: true, data: { nested: [Infinity] } };
    expect(utilityFormErrors(defaults, schema, params, {})).toHaveProperty('data');
    expect(utilityFormErrors(defaults, schema, { ...params, enabled: false }, {})).toHaveProperty('$form');
    const extra = { enabled: true, data: {}, unknown: Infinity };
    expect(utilityFormErrors(defaults, schema, extra, {})).toHaveProperty('$form');
  });
  it('deep copies starting defaults', () => {
    const defaults = { rows: [{ value: 1 }] };
    const params = initialUtilityParams(defaults);
    (params.rows as { value: number }[])[0].value = 3;
    expect(defaults.rows[0].value).toBe(1);
  });
});
