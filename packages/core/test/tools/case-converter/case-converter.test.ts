import { describe, it, expect } from 'vitest';
import { caseConverter } from '../../../src/tools/case-converter/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function convert(text: string, targetCase: string): Promise<string> {
  const file = new File([text], 'input.txt', { type: 'text/plain' });
  const [out] = await caseConverter.run(
    [file],
    { case: targetCase as never },
    makeCtx(),
  ) as Blob[];
  return out!.text();
}

describe('case-converter — metadata', () => {
  it('has id case-converter', () => {
    expect(caseConverter.id).toBe('case-converter');
  });

  it('is in the dev category', () => {
    expect(caseConverter.category).toBe('dev');
  });

  it('accepts text/plain', () => {
    expect(caseConverter.input.accept).toContain('text/plain');
    expect(caseConverter.input.min).toBe(1);
    expect(caseConverter.input.max).toBe(1);
  });

  it('outputs text/plain', () => {
    expect(caseConverter.output.mime).toBe('text/plain');
  });
});

describe('case-converter — run()', () => {
  it('converts to upper', async () => {
    expect(await convert('hello world', 'upper')).toBe('HELLO WORLD');
  });

  it('converts to lower', async () => {
    expect(await convert('HELLO WORLD', 'lower')).toBe('hello world');
  });

  it('converts to title', async () => {
    expect(await convert('hello world', 'title')).toBe('Hello World');
  });

  it('converts to camelCase', async () => {
    expect(await convert('hello world', 'camel')).toBe('helloWorld');
  });

  it('converts to snake_case', async () => {
    expect(await convert('hello world', 'snake')).toBe('hello_world');
  });

  it('converts to kebab-case', async () => {
    expect(await convert('hello world', 'kebab')).toBe('hello-world');
  });

  it('converts to PascalCase', async () => {
    expect(await convert('hello world', 'pascal')).toBe('HelloWorld');
  });

  it('converts to CONSTANT_CASE', async () => {
    expect(await convert('hello world', 'constant')).toBe('HELLO_WORLD');
  });

  it('splits camelCase input to words correctly', async () => {
    expect(await convert('helloWorld', 'snake')).toBe('hello_world');
  });

  it('handles aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: ctrl.signal,
      cache: new Map(),
      executionId: 'test',
    };
    const file = new File(['text'], 'input.txt', { type: 'text/plain' });
    await expect(caseConverter.run([file], { case: 'upper' }, ctx)).rejects.toThrow('Aborted');
  });
});
