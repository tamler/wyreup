import { describe, expect, it } from 'vitest';
import { formatJsonText } from '../../../src/tools/json-formatter/index.js';

describe('bounded JSON formatting and validation', () => {
  it('sorts nested keys without changing array order or integer-key JSON semantics', () => {
    expect(formatJsonText('{"b":1,"10":2,"2":3}', { indent: 0, sortKeys: true })).toBe('{"2":3,"10":2,"b":1}');
    expect(formatJsonText('{"z":[{"b":2,"a":1},3],"a":0}', { indent: 0, sortKeys: true })).toBe('{"a":0,"z":[{"a":1,"b":2},3]}');
    expect(formatJsonText('{"z":1,"a":2}', { indent: 0 })).toBe('{"z":1,"a":2}');
  });
  it('keeps prototype-shaped keys as own JSON data', () => {
    expect(formatJsonText('{"z":1,"__proto__":{"polluted":true},"constructor":3}', { indent: 0, sortKeys: true })).toBe('{"__proto__":{"polluted":true},"constructor":3,"z":1}');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('reports real parse failures without invented locations', () => {
    expect(JSON.parse(formatJsonText('{"a":1}', { validationOnly: true }))).toEqual({ valid: true });
    const result = JSON.parse(formatJsonText('{bad}', { validationOnly: true })) as { valid: boolean; error: string };
    expect(result.valid).toBe(false); expect(result.error).toContain('Invalid JSON');
    expect(() => formatJsonText('{bad}')).toThrow('Invalid JSON');
  });
  it('enforces nesting, value, finite-number and parameter bounds', () => {
    expect(() => formatJsonText('['.repeat(129) + '0' + ']'.repeat(129))).toThrow('128 levels');
    expect(() => formatJsonText('[' + Array(100000).fill('0').join(',') + ']')).toThrow('100,000');
    expect(() => formatJsonText('1e400')).toThrow('finite');
    expect(() => formatJsonText('{}', { indent: 1.5 })).toThrow();
    expect(() => formatJsonText('{}', { unknown: true } as never)).toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => formatJsonText('{}', {}, controller.signal)).toThrow('cancelled');
  });
});
