import { describe, expect, it } from 'vitest';
import { classifyJsonValue, formatValue, humanizeKey } from '../src/components/runners/jsonView';

describe('classifyJsonValue', () => {
  it('classifies a non-empty object of primitive values as flat', () => {
    expect(classifyJsonValue({ bytesIn: 1234, valid: true, note: null })).toEqual({
      kind: 'flat',
      entries: [
        ['bytesIn', 1234],
        ['valid', true],
        ['note', null],
      ],
    });
  });

  it('classifies compatible object arrays as tables and preserves column order', () => {
    expect(
      classifyJsonValue([
        { name: 'alpha', score: 1200 },
        { name: 'beta', active: true },
      ]),
    ).toEqual({
      kind: 'table',
      columns: ['name', 'score', 'active'],
      rows: [
        { name: 'alpha', score: 1200 },
        { name: 'beta', active: true },
      ],
    });
  });

  it('classifies mixed supported object values as sections', () => {
    const view = classifyJsonValue({
      total: 2,
      warnings: ['one', 'two'],
      stats: { bytesIn: 100, bytesOut: 75 },
      rows: [
        { name: 'alpha', value: 1 },
        { name: 'beta', value: 2 },
      ],
    });

    expect(view?.kind).toBe('sections');
    if (view?.kind !== 'sections') return;
    expect(view.sections.map(({ kind, key }) => [key, kind])).toEqual([
      ['total', 'primitive'],
      ['warnings', 'primitive-array'],
      ['stats', 'flat'],
      ['rows', 'table'],
    ]);
  });

  it('rejects unsupported values and arbitrary nesting', () => {
    expect(classifyJsonValue(null)).toBeNull();
    expect(classifyJsonValue([])).toBeNull();
    expect(classifyJsonValue({})).toBeNull();
    expect(classifyJsonValue({ a: { b: { c: 1 } } })).toBeNull();
  });

  it('enforces flat-object and primitive-array caps', () => {
    expect(
      classifyJsonValue(
        Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index, index])),
      ),
    ).not.toBeNull();
    expect(
      classifyJsonValue(
        Object.fromEntries(Array.from({ length: 41 }, (_, index) => [index, index])),
      ),
    ).toBeNull();
    expect(
      classifyJsonValue({ values: Array.from({ length: 50 }, (_, index) => index) }),
    ).not.toBeNull();
    expect(
      classifyJsonValue({ values: Array.from({ length: 51 }, (_, index) => index) }),
    ).toBeNull();
  });

  it('enforces table row, column, and common-key constraints', () => {
    expect(
      classifyJsonValue(Array.from({ length: 200 }, (_, index) => ({ id: index }))),
    ).not.toBeNull();
    expect(
      classifyJsonValue(Array.from({ length: 201 }, (_, index) => ({ id: index }))),
    ).toBeNull();
    expect(classifyJsonValue([{ id: 1 }])).toBeNull();
    expect(
      classifyJsonValue([
        Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`key${index}`, index])),
        Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`key${index}`, index + 1])),
      ]),
    ).toBeNull();
    expect(classifyJsonValue([{ left: 1 }, { right: 2 }])).toBeNull();
  });

  it('enforces the global 300-leaf cap', () => {
    expect(
      classifyJsonValue({
        a: Array(50).fill(1),
        b: Array(50).fill(1),
        c: Array(50).fill(1),
        d: Array(50).fill(1),
        e: Array(50).fill(1),
        f: Array(50).fill(1),
      }),
    ).not.toBeNull();
    expect(
      classifyJsonValue({
        a: Array(50).fill(1),
        b: Array(50).fill(1),
        c: Array(50).fill(1),
        d: Array(50).fill(1),
        e: Array(50).fill(1),
        f: Array(50).fill(1),
        g: [1],
      }),
    ).toBeNull();
    expect(
      classifyJsonValue(Array.from({ length: 151 }, (_, index) => ({ id: index, value: index }))),
    ).toBeNull();
  });
});

describe('real tool result shapes', () => {
  it('classifies cron-parser output as sections', () => {
    const view = classifyJsonValue({
      expression: '0 9 * * 1-5',
      nextRuns: ['2026-07-13T01:00:00.000Z', '2026-07-14T01:00:00.000Z'],
      fields: {
        minute: [0],
        hour: [9],
        dayOfWeek: [1, 2, 3, 4, 5],
      },
    });

    expect(view?.kind).toBe('sections');
    if (view?.kind !== 'sections') return;
    expect(view.sections.map(({ kind }) => kind)).toEqual([
      'primitive',
      'primitive-array',
      'group',
    ]);
  });

  it('classifies unicode-info output as sections with a chars table', () => {
    const view = classifyJsonValue({
      chars: [
        { char: 'A', codePoint: 'U+0041', name: 'LATIN CAPITAL LETTER A', bytes: 1 },
        { char: 'Ω', codePoint: 'U+03A9', name: 'GREEK CAPITAL LETTER OMEGA', bytes: 2 },
      ],
    });

    expect(view?.kind).toBe('sections');
    if (view?.kind !== 'sections') return;
    expect(view.sections[0]?.kind).toBe('table');
  });

  it('classifies pdf-form-fields output as sections with a fields table', () => {
    const view = classifyJsonValue({
      fields: [
        { name: 'email', type: 'text', value: 'reader@example.com' },
        { name: 'terms', type: 'checkbox', value: true },
      ],
    });

    expect(view?.kind).toBe('sections');
    if (view?.kind !== 'sections') return;
    expect(view.sections[0]?.kind).toBe('table');
  });

  it('classifies html-extract-links output as sections', () => {
    const view = classifyJsonValue({
      total: 2,
      byKind: { a: 2 },
      hostnames: { 'example.com': 3 },
      links: [
        { kind: 'a', url: 'https://example.com/one' },
        { kind: 'a', url: 'https://example.com/two' },
      ],
    });

    expect(view?.kind).toBe('sections');
    if (view?.kind !== 'sections') return;
    expect(view.sections.map(({ kind }) => kind)).toEqual(['primitive', 'flat', 'flat', 'table']);
  });

  it('classifies css-minify output as sections', () => {
    const view = classifyJsonValue({
      bytesIn: 1200,
      bytesOut: 800,
      reductionPercent: 33.3,
      warnings: ['Unknown vendor property'],
    });

    expect(view?.kind).toBe('sections');
    if (view?.kind !== 'sections') return;
    expect(view.sections.map(({ kind }) => kind)).toEqual([
      'primitive',
      'primitive',
      'primitive',
      'primitive-array',
    ]);
  });
});

describe('formatting helpers', () => {
  it.each([
    ['camelCaseKey', 'Camel Case Key'],
    ['snake_case_key', 'Snake Case Key'],
    ['kebab-case-key', 'Kebab Case Key'],
    ['durationMilliseconds', 'Duration (milliseconds)'],
    ['size_bytes', 'Size (bytes)'],
    ['HTTP status', 'Http Status'],
  ])('humanizes %s', (key, expected) => {
    expect(humanizeKey(key)).toBe(expected);
  });

  it('formats numbers, nulls, booleans, and strings', () => {
    expect(formatValue(1234567)).toBe((1234567).toLocaleString());
    expect(formatValue(null)).toBe('—');
    expect(formatValue(false)).toBe('false');
    expect(formatValue('value')).toBe('value');
  });
});
