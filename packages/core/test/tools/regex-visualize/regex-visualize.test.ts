import { describe, it, expect } from 'vitest';
import { visualizeRegex, regexVisualize } from '../../../src/tools/regex-visualize/index.js';

describe('regex-visualize — metadata', () => {
  it('has id regex-visualize', () => {
    expect(regexVisualize.id).toBe('regex-visualize');
  });

  it('is in the inspect category', () => {
    expect(regexVisualize.category).toBe('inspect');
  });

  it('outputs image/svg+xml', () => {
    expect(regexVisualize.output.mime).toBe('image/svg+xml');
  });

  it('accepts no file input by default (params-driven)', () => {
    expect(regexVisualize.input.min).toBe(0);
  });
});

describe('visualizeRegex', () => {
  it('renders a simple literal pattern', () => {
    const r = visualizeRegex('/abc/');
    expect(r.svg).toContain('<svg');
    expect(r.svg).toContain('</svg>');
    expect(r.nodeCount).toBeGreaterThan(0);
  });

  it('accepts bare patterns (no slashes)', () => {
    const r = visualizeRegex('abc');
    expect(r.svg).toContain('<svg');
  });

  it('renders alternation as boxed alternatives', () => {
    const r = visualizeRegex('/foo|bar/');
    expect(r.svg).toContain('stroke-dasharray="3 3"');
  });

  it('renders repetition with a quantifier label', () => {
    const r = visualizeRegex('/[a-z]+/');
    expect(r.svg).toMatch(/1 or more/);
  });

  it('labels character classes', () => {
    const r = visualizeRegex('/[a-zA-Z0-9]/');
    expect(r.svg).toContain('a-z');
  });

  it('labels assertions', () => {
    const r = visualizeRegex('/^foo$/');
    expect(r.svg).toContain('start');
    expect(r.svg).toContain('end');
  });

  it('escapes XML in labels', () => {
    const r = visualizeRegex('/<tag>/');
    expect(r.svg).toContain('&lt;');
    expect(r.svg).toContain('&gt;');
  });

  it('throws on an empty pattern', () => {
    expect(() => visualizeRegex('')).toThrow();
    expect(() => visualizeRegex('   ')).toThrow();
  });

  it('throws on unparseable regex', () => {
    expect(() => visualizeRegex('[unclosed')).toThrow(/parse/);
  });
});
