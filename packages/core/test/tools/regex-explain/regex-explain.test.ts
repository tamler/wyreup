import { describe, it, expect } from 'vitest';
import { explainRegex, regexExplain } from '../../../src/tools/regex-explain/index.js';

describe('regex-explain — metadata', () => {
  it('has id regex-explain', () => {
    expect(regexExplain.id).toBe('regex-explain');
  });
  it('is in the inspect category', () => {
    expect(regexExplain.category).toBe('inspect');
  });
  it('outputs application/json', () => {
    expect(regexExplain.output.mime).toBe('application/json');
  });
  it('declares free cost', () => {
    expect(regexExplain.cost).toBe('free');
  });
});

describe('explainRegex — basic parts', () => {
  it('explains literal characters', () => {
    const r = explainRegex('/abc/');
    expect(r.breakdown.length).toBe(3);
    expect(r.breakdown[0]!.meaning).toMatch(/literal "a"/);
  });

  it('explains digit meta', () => {
    const r = explainRegex('/\\d+/');
    expect(r.breakdown.some((n) => /digit/.test(n.meaning))).toBe(true);
  });

  it('explains word meta', () => {
    const r = explainRegex('/\\w/');
    expect(r.breakdown[0]!.meaning).toMatch(/word character/);
  });

  it('explains quantifier as repetition', () => {
    const r = explainRegex('/a+/');
    expect(r.breakdown.some((n) => /one or more/.test(n.meaning))).toBe(true);
  });

  it('explains character class', () => {
    const r = explainRegex('/[a-z]/');
    expect(r.breakdown.some((n) => n.kind === 'class')).toBe(true);
    expect(r.breakdown.find((n) => n.kind === 'class')!.meaning).toMatch(/a-z/);
  });

  it('explains negated character class', () => {
    const r = explainRegex('/[^0-9]/');
    expect(r.breakdown.find((n) => n.kind === 'class')!.meaning).toMatch(/NOT/);
  });

  it('explains assertions ^ and $', () => {
    const r = explainRegex('/^foo$/');
    const meanings = r.breakdown.map((n) => n.meaning).join(' ');
    expect(meanings).toMatch(/start/);
    expect(meanings).toMatch(/end/);
  });
});

describe('explainRegex — groups and alternation', () => {
  it('explains a capturing group', () => {
    const r = explainRegex('/(abc)/');
    expect(r.breakdown.some((n) => n.kind === 'group' && /capture/.test(n.meaning))).toBe(true);
  });

  it('explains a named group', () => {
    const r = explainRegex('/(?<name>\\w+)/');
    expect(r.breakdown.some((n) => /named group "name"/.test(n.meaning))).toBe(true);
  });

  it('explains a non-capturing group', () => {
    const r = explainRegex('/(?:abc)/');
    expect(r.breakdown.some((n) => /non-capturing/.test(n.meaning))).toBe(true);
  });

  it('explains alternation', () => {
    const r = explainRegex('/cat|dog/');
    expect(r.breakdown.some((n) => n.kind === 'alternation')).toBe(true);
  });
});

describe('explainRegex — flags and summary', () => {
  it('notes the i flag', () => {
    const r = explainRegex('/abc/i');
    expect(r.flags).toBe('i');
    expect(r.summary).toMatch(/case-insensitive/);
  });

  it('notes the g flag', () => {
    const r = explainRegex('/abc/g');
    expect(r.summary).toMatch(/globally/);
  });

  it('accepts bare patterns without slashes', () => {
    const r = explainRegex('abc');
    expect(r.flags).toBe('');
    expect(r.breakdown.length).toBe(3);
  });
});

describe('explainRegex — known-pattern recognition', () => {
  it('recognises the email pattern', () => {
    const r = explainRegex('/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/');
    expect(r.recognisedAs).toMatch(/[Ee]mail/);
    expect(r.summary).toMatch(/Recognised pattern/);
  });

  it('recognises ISO dates', () => {
    const r = explainRegex('/\\d{4}-\\d{2}-\\d{2}/');
    expect(r.recognisedAs).toMatch(/ISO dates/);
  });
});

describe('explainRegex — errors', () => {
  it('throws on empty input', () => {
    expect(() => explainRegex('')).toThrow();
    expect(() => explainRegex('   ')).toThrow();
  });

  it('throws on unparseable regex', () => {
    expect(() => explainRegex('[unclosed')).toThrow(/[Pp]arse/);
  });
});
