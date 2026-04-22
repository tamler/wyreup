import { describe, it, expect } from 'vitest';
import { unitConverter } from '../../../src/tools/unit-converter/index.js';

const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'test',
};

async function run(params: Parameters<typeof unitConverter.run>[1]): Promise<Record<string, unknown>> {
  const [blob] = await unitConverter.run([], params, ctx) as Blob[];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(await blob!.text());
}

describe('unit-converter — metadata', () => {
  it('has id unit-converter', () => {
    expect(unitConverter.id).toBe('unit-converter');
  });

  it('is in the create category', () => {
    expect(unitConverter.category).toBe('create');
  });

  it('outputs application/json', () => {
    expect(unitConverter.output.mime).toBe('application/json');
  });
});

describe('unit-converter — conversions', () => {
  it('converts km to m', async () => {
    const r = await run({ value: 1, from: 'km', to: 'm', category: 'length' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1000, 3);
  });

  it('converts ft to m', async () => {
    const r = await run({ value: 5, from: 'ft', to: 'm', category: 'length' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1.524, 3);
  });

  it('converts kg to lb', async () => {
    const r = await run({ value: 1, from: 'kg', to: 'lb', category: 'mass' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(2.20462, 3);
  });

  it('converts Celsius to Fahrenheit', async () => {
    const r = await run({ value: 100, from: 'C', to: 'F', category: 'temperature' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(212, 2);
  });

  it('converts Fahrenheit to Kelvin', async () => {
    const r = await run({ value: 32, from: 'F', to: 'K', category: 'temperature' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(273.15, 2);
  });

  it('converts L to gal', async () => {
    const r = await run({ value: 3.785411784, from: 'L', to: 'gal', category: 'volume' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1, 3);
  });

  it('converts MB to MiB', async () => {
    const r = await run({ value: 1, from: 'MB', to: 'MiB', category: 'data' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(0.953674, 4);
  });

  it('converts hours to seconds', async () => {
    const r = await run({ value: 1, from: 'h', to: 's', category: 'time' });
    expect(r.valid).toBe(true);
    expect(r.result).toBe(3600);
  });

  it('auto-detects category when omitted', async () => {
    const r = await run({ value: 1, from: 'km', to: 'm' });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(1000, 3);
  });

  it('returns valid: false for unknown unit', async () => {
    const r = await run({ value: 1, from: 'parsec', to: 'm', category: 'length' });
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('includes formatted string in output', async () => {
    const r = await run({ value: 5, from: 'ft', to: 'm', category: 'length' });
    expect(typeof r.formatted).toBe('string');
    expect(r.formatted as string).toContain('ft');
    expect(r.formatted as string).toContain('m');
  });
});
