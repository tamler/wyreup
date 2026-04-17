import { describe, it, expect } from 'vitest';
import { regexTester } from '../../../src/tools/regex-tester/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { RegexTesterResult } from '../../../src/tools/regex-tester/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function test(text: string, pattern: string, flags = 'g'): Promise<RegexTesterResult> {
  const file = new File([text], 'input.txt', { type: 'text/plain' });
  const [out] = await regexTester.run([file], { pattern, flags }, makeCtx());
  return JSON.parse(await out!.text()) as RegexTesterResult;
}

describe('regex-tester — metadata', () => {
  it('has id regex-tester', () => {
    expect(regexTester.id).toBe('regex-tester');
  });

  it('is in the inspect category', () => {
    expect(regexTester.category).toBe('inspect');
  });

  it('accepts text/plain, min 1, max 1', () => {
    expect(regexTester.input.accept).toContain('text/plain');
    expect(regexTester.input.min).toBe(1);
    expect(regexTester.input.max).toBe(1);
  });
});

describe('regex-tester — run()', () => {
  it('finds matches in text', async () => {
    const result = await test('hello world hello', 'hello', 'g');
    expect(result.valid).toBe(true);
    expect(result.matchCount).toBe(2);
    expect(result.matches.length).toBe(2);
    expect(result.matches[0]!.match).toBe('hello');
  });

  it('returns match positions (index)', async () => {
    const result = await test('abc def abc', 'abc', 'g');
    expect(result.matches[0]!.index).toBe(0);
    expect(result.matches[1]!.index).toBe(8);
  });

  it('handles named groups', async () => {
    const result = await test('2026-04-15', '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})', 'g');
    expect(result.valid).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.matches[0]!.groups).toBeDefined();
    expect(result.matches[0]!.groups!['year']).toBe('2026');
    expect(result.matches[0]!.groups!['month']).toBe('04');
    expect(result.matches[0]!.groups!['day']).toBe('15');
  });

  it('returns valid:false for invalid regex syntax', async () => {
    const result = await test('some text', '[invalid(', 'g');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.matchCount).toBe(0);
  });

  it('handles no matches', async () => {
    const result = await test('hello world', 'xyz', 'g');
    expect(result.valid).toBe(true);
    expect(result.matchCount).toBe(0);
    expect(result.matches.length).toBe(0);
  });

  it('output MIME type is application/json', async () => {
    const file = new File(['test'], 'input.txt', { type: 'text/plain' });
    const [out] = await regexTester.run([file], { pattern: 'test' }, makeCtx());
    expect(out!.type).toBe('application/json');
  });

  it('handles non-global flags (single match)', async () => {
    const result = await test('aaa', 'a', '');
    expect(result.valid).toBe(true);
    expect(result.matchCount).toBe(1);
  });
});
