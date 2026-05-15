import { describe, it, expect } from 'vitest';
import { generateRegexFromText, regexFromText } from '../../../src/tools/regex-from-text/index.js';

describe('regex-from-text — metadata', () => {
  it('has id regex-from-text', () => {
    expect(regexFromText.id).toBe('regex-from-text');
  });

  it('is in the inspect category', () => {
    expect(regexFromText.category).toBe('inspect');
  });

  it('outputs application/json', () => {
    expect(regexFromText.output.mime).toBe('application/json');
  });

  it('accepts no file input by default (params-driven)', () => {
    expect(regexFromText.input.min).toBe(0);
  });

  it('declares free cost (heuristic, no model)', () => {
    expect(regexFromText.cost).toBe('free');
  });
});

describe('regexFromText — common patterns', () => {
  it('matches email request', () => {
    const r = generateRegexFromText('match email addresses');
    expect(r.pattern).toContain('@');
    expect(r.explanation).toMatch(/[Ee]mail/);
    expect(r.confidence).toBe('high');
  });

  it('matches URL request', () => {
    const r = generateRegexFromText('find URLs');
    expect(r.pattern).toContain('https?');
    expect(r.confidence).toBe('high');
  });

  it('matches phone number request', () => {
    const r = generateRegexFromText('extract phone numbers');
    expect(r.pattern).toContain('\\d{3}');
    expect(r.confidence).toBe('high');
  });

  it('matches ISO date request', () => {
    const r = generateRegexFromText('find ISO dates');
    expect(r.pattern).toBe('\\d{4}-\\d{2}-\\d{2}');
  });

  it('matches UUID request and applies its default flags', () => {
    const r = generateRegexFromText('extract uuids');
    expect(r.pattern).toMatch(/^\[0-9a-f\]\{8\}/);
    expect(r.flags).toContain('i');
  });

  it('matches hex color request', () => {
    const r = generateRegexFromText('match hex colors');
    expect(r.pattern).toContain('#');
    expect(r.pattern).toContain('[0-9a-fA-F]');
  });

  it('matches credit card request', () => {
    const r = generateRegexFromText('find credit card numbers');
    expect(r.pattern).toMatch(/\\d\{4\}/);
  });

  it('matches IPv4 over generic "ip" via longer keyword', () => {
    const r = generateRegexFromText('extract ipv4 addresses');
    expect(r.pattern).toContain('\\d{1,3}');
  });
});

describe('regexFromText — flag modifiers', () => {
  it('adds /i for "case insensitive"', () => {
    const r = generateRegexFromText('match email addresses case insensitive');
    expect(r.flags).toContain('i');
  });

  it('adds /m for "multiline"', () => {
    const r = generateRegexFromText('blank lines multiline');
    expect(r.flags).toContain('m');
  });

  it('drops /g for "first match only"', () => {
    const r = generateRegexFromText('find URLs first match only');
    expect(r.flags).not.toContain('g');
  });

  it('honors an explicit flags param over inference', () => {
    const r = generateRegexFromText('match email addresses case insensitive', 'g');
    expect(r.flags).toBe('g');
    expect(r.flags).not.toContain('i');
  });
});

describe('regexFromText — output shape', () => {
  it('returns a renderable fullRegex', () => {
    const r = generateRegexFromText('match email addresses');
    expect(r.fullRegex).toMatch(/^\/.+\/[gimsu]*$/);
  });

  it('exposes alternative matches when multiple hits fire', () => {
    // "ip" matches multiple entries (ipv4, ipv6 if phrased)
    const r = generateRegexFromText('match ip addresses');
    expect(r.matchedKeywords.length).toBeGreaterThanOrEqual(1);
  });

  it('lists matched keywords for transparency', () => {
    const r = generateRegexFromText('match email addresses');
    expect(r.matchedKeywords.some((k) => k.includes('email'))).toBe(true);
  });
});

describe('regexFromText — no-match path', () => {
  it('returns a no-match result with an upgrade hint', () => {
    const r = generateRegexFromText('the moon orbits the earth');
    expect(r.confidence).toBe('no-match');
    expect(r.pattern).toBe('');
    expect(r.upgrade).toMatch(/Pro/);
  });

  it('throws on empty description', () => {
    expect(() => generateRegexFromText('')).toThrow();
    expect(() => generateRegexFromText('   ')).toThrow();
  });
});

describe('regexFromText — generated regex is well-formed', () => {
  const inputs = [
    'match email addresses',
    'find URLs',
    'extract phone numbers',
    'find ISO dates',
    'extract uuids',
    'match hex colors',
    'find credit card numbers',
    'extract ipv4 addresses',
    'match semantic versions',
    'match percentages',
  ];

  for (const desc of inputs) {
    it(`compiles for: "${desc}"`, () => {
      const r = generateRegexFromText(desc);
      // Should be a valid JavaScript RegExp.
      expect(() => new RegExp(r.pattern, r.flags)).not.toThrow();
    });
  }
});
