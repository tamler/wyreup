import { describe, it, expect } from 'vitest';
import { calculator, evaluate } from '../../../src/tools/calculator/index.js';

describe('calculator — metadata', () => {
  it('has id calculator', () => {
    expect(calculator.id).toBe('calculator');
  });

  it('is in the create category', () => {
    expect(calculator.category).toBe('create');
  });

  it('outputs application/json', () => {
    expect(calculator.output.mime).toBe('application/json');
  });

  it('accepts no file input', () => {
    expect(calculator.input.min).toBe(0);
    expect(calculator.input.max).toBe(0);
  });
});

describe('calculator — evaluate()', () => {
  it('adds two numbers', () => {
    const r = evaluate('2 + 3');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(5);
  });

  it('respects operator precedence (multiplication before addition)', () => {
    const r = evaluate('2 + 3 * 4');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(14);
  });

  it('handles parentheses', () => {
    const r = evaluate('(2 + 3) * 4');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(20);
  });

  it('computes power with ^', () => {
    const r = evaluate('2 ^ 8');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(256);
  });

  it('computes sqrt', () => {
    const r = evaluate('sqrt(9)');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(3);
  });

  it('uses pi constant', () => {
    const r = evaluate('pi * 2');
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(6.2832, 3);
  });

  it('computes sin(90) in deg mode', () => {
    const r = evaluate('sin(90)', 'deg');
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1, 5);
  });

  it('computes cos(0) correctly', () => {
    const r = evaluate('cos(0)', 'deg');
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1, 5);
  });

  it('handles unary minus', () => {
    const r = evaluate('-5 + 10');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(5);
  });

  it('reports division by zero as invalid', () => {
    const r = evaluate('10 / 0');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/zero/i);
  });

  it('returns invalid for empty expression', () => {
    const r = evaluate('');
    expect(r.valid).toBe(false);
  });

  it('returns invalid for garbage input', () => {
    const r = evaluate('hello world');
    expect(r.valid).toBe(false);
  });

  it('handles abs() correctly', () => {
    const r = evaluate('abs(-42)');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(42);
  });

  it('computes ln correctly', () => {
    const r = evaluate('ln(e)');
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1, 5);
  });

  it('computes log(100) = 2', () => {
    const r = evaluate('log(100)');
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(2, 5);
  });

  it('handles modulo', () => {
    const r = evaluate('10 % 3');
    expect(r.valid).toBe(true);
    expect(r.result).toBe(1);
  });
});

describe('calculator — run()', () => {
  const ctx = {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };

  it('returns JSON blob with valid result', async () => {
    const [blob] = await calculator.run([], { expression: '6 * 7', angleMode: 'deg' }, ctx) as Blob[];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = JSON.parse(await blob!.text());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(json.valid).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(json.result).toBe(42);
  });

  it('returns valid: false for bad expression in JSON', async () => {
    const [blob] = await calculator.run([], { expression: 'bad!!', angleMode: 'deg' }, ctx) as Blob[];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json = JSON.parse(await blob!.text());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(json.valid).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(json.error).toBeDefined();
  });
});
