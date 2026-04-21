import { describe, it, expect } from 'vitest';
import { slug } from '../../../src/tools/slug/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { SlugParams } from '../../../src/tools/slug/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: SlugParams = {}): Promise<string> {
  const file = new File([text], 'input.txt', { type: 'text/plain' });
  const [out] = await slug.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

describe('slug — metadata', () => {
  it('has id slug', () => {
    expect(slug.id).toBe('slug');
  });

  it('is in the create category', () => {
    expect(slug.category).toBe('create');
  });

  it('outputs text/plain', () => {
    expect(slug.output.mime).toBe('text/plain');
  });
});

describe('slug — run()', () => {
  it('converts basic text to slug', async () => {
    expect(await run('Hello World')).toBe('hello-world');
  });

  it('strips diacritics', async () => {
    expect(await run('Héllo Wörld')).toBe('hello-world');
  });

  it('collapses multiple spaces', async () => {
    expect(await run('hello   world')).toBe('hello-world');
  });

  it('removes special characters', async () => {
    expect(await run('hello! world?')).toBe('hello-world');
  });

  it('supports underscore separator', async () => {
    expect(await run('hello world', { separator: '_' })).toBe('hello_world');
  });

  it('respects maxLength', async () => {
    const result = await run('hello world foo bar', { maxLength: 11 });
    expect(result.length).toBeLessThanOrEqual(11);
    expect(result).not.toMatch(/-$/);
  });

  it('preserves case when lowercase is false', async () => {
    expect(await run('Hello World', { lowercase: false })).toBe('Hello-World');
  });

  it('handles empty string', async () => {
    expect(await run('')).toBe('');
  });
});
