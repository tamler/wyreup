import { describe, it, expect } from 'vitest';
import { timestampConverter } from '../../../src/tools/timestamp-converter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { TimestampConverterResult } from '../../../src/tools/timestamp-converter/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function convert(input: string): Promise<TimestampConverterResult> {
  const file = new File([input], 'ts.txt', { type: 'text/plain' });
  const [out] = await timestampConverter.run([file], {}, makeCtx());
  return JSON.parse(await out!.text()) as TimestampConverterResult;
}

describe('timestamp-converter — metadata', () => {
  it('has id timestamp-converter', () => {
    expect(timestampConverter.id).toBe('timestamp-converter');
  });

  it('is in the inspect category', () => {
    expect(timestampConverter.category).toBe('inspect');
  });

  it('accepts text/plain, min 1, max 1', () => {
    expect(timestampConverter.input.accept).toContain('text/plain');
    expect(timestampConverter.input.min).toBe(1);
    expect(timestampConverter.input.max).toBe(1);
  });
});

describe('timestamp-converter — run()', () => {
  it('parses epoch seconds (1776000000)', async () => {
    const result = await convert('1776000000');
    expect(result.valid).toBe(true);
    expect(result.epochSeconds).toBe(1776000000);
    expect(result.epochMilliseconds).toBe(1776000000 * 1000);
    expect(result.iso8601).toBeTruthy();
    expect(result.iso8601).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('parses ISO 8601 string', async () => {
    const isoStr = '2026-04-15T12:00:00.000Z';
    const expectedMs = new Date(isoStr).getTime();
    const result = await convert(isoStr);
    expect(result.valid).toBe(true);
    expect(result.epochSeconds).toBe(Math.floor(expectedMs / 1000));
    expect(result.epochMilliseconds).toBe(expectedMs);
    expect(result.iso8601).toBe(isoStr);
  });

  it('parses epoch milliseconds (>= 10^10)', async () => {
    const ms = 1744718400000;
    const result = await convert(String(ms));
    expect(result.valid).toBe(true);
    expect(result.epochMilliseconds).toBe(ms);
    expect(result.epochSeconds).toBe(Math.floor(ms / 1000));
  });

  it('returns valid:false for garbage input', async () => {
    const result = await convert('not-a-date');
    expect(result.valid).toBe(false);
    expect(result.epochSeconds).toBeNull();
    expect(result.iso8601).toBeNull();
  });

  it('relative field is a string for valid input', async () => {
    const result = await convert('1776000000');
    expect(typeof result.relative).toBe('string');
    expect(result.relative!.length).toBeGreaterThan(0);
  });

  it('utc field is a string for valid input', async () => {
    const result = await convert('2026-04-15T12:00:00.000Z');
    expect(typeof result.utc).toBe('string');
    expect(result.utc).toContain('GMT');
  });

  it('local field is a string for valid input', async () => {
    const result = await convert('2026-04-15T12:00:00.000Z');
    expect(typeof result.local).toBe('string');
    expect(result.local!.length).toBeGreaterThan(0);
  });
});
