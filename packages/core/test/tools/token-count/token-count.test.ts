import { describe, it, expect } from 'vitest';
import { tokenCount } from '../../../src/tools/token-count/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('token-count — metadata', () => {
  it('has id token-count', () => {
    expect(tokenCount.id).toBe('token-count');
  });

  it('is in the dev category', () => {
    expect(tokenCount.category).toBe('dev');
  });

  it('accepts text/plain', () => {
    expect(tokenCount.input.accept).toContain('text/plain');
  });

  it('outputs application/json', () => {
    expect(tokenCount.output.mime).toBe('application/json');
  });

  it('has no installSize', () => {
    expect(tokenCount.installSize).toBeUndefined();
  });

  it('defaults to gpt-4o model', () => {
    expect(tokenCount.defaults.model).toBe('gpt-4o');
  });
});

describe('token-count — run()', () => {
  it('counts tokens for a simple string (gpt-4o)', async () => {
    const input = new File(['Hello, world!'], 'test.txt', { type: 'text/plain' });
    const [out] = await tokenCount.run([input], { model: 'gpt-4o' }, makeCtx()) as Blob[];
    const data = JSON.parse(await out!.text());
    expect(data.tokens).toBeGreaterThan(0);
    expect(data.model).toBe('gpt-4o');
    expect(data.characters).toBe(13);
    expect(typeof data.ratio).toBe('number');
  });

  it('counts tokens for gpt-4', async () => {
    const input = new File(['Hello, world!'], 'test.txt', { type: 'text/plain' });
    const [out] = await tokenCount.run([input], { model: 'gpt-4' }, makeCtx()) as Blob[];
    const data = JSON.parse(await out!.text());
    expect(data.tokens).toBeGreaterThan(0);
    expect(data.model).toBe('gpt-4');
  });

  it('counts tokens for gpt-3.5-turbo', async () => {
    const input = new File(['Hello, world!'], 'test.txt', { type: 'text/plain' });
    const [out] = await tokenCount.run([input], { model: 'gpt-3.5-turbo' }, makeCtx()) as Blob[];
    const data = JSON.parse(await out!.text());
    expect(data.tokens).toBeGreaterThan(0);
    expect(data.model).toBe('gpt-3.5-turbo');
  });

  it('token count is consistent for same text', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const input1 = new File([text], 'a.txt', { type: 'text/plain' });
    const input2 = new File([text], 'b.txt', { type: 'text/plain' });
    const [out1] = await tokenCount.run([input1], { model: 'gpt-4' }, makeCtx()) as Blob[];
    const [out2] = await tokenCount.run([input2], { model: 'gpt-4' }, makeCtx()) as Blob[];
    const d1 = JSON.parse(await out1!.text());
    const d2 = JSON.parse(await out2!.text());
    expect(d1.tokens).toBe(d2.tokens);
  });

  it('longer text has more tokens', async () => {
    const short = new File(['Hi'], 'short.txt', { type: 'text/plain' });
    const long = new File(['Hello, world! This is a longer sentence with many words.'], 'long.txt', { type: 'text/plain' });
    const [outShort] = await tokenCount.run([short], { model: 'gpt-4o' }, makeCtx()) as Blob[];
    const [outLong] = await tokenCount.run([long], { model: 'gpt-4o' }, makeCtx()) as Blob[];
    const dShort = JSON.parse(await outShort!.text());
    const dLong = JSON.parse(await outLong!.text());
    expect(dLong.tokens).toBeGreaterThan(dShort.tokens);
  });

  it('ratio is tokens/chars', async () => {
    const text = 'Hello world';
    const input = new File([text], 't.txt', { type: 'text/plain' });
    const [out] = await tokenCount.run([input], { model: 'gpt-4o' }, makeCtx()) as Blob[];
    const data = JSON.parse(await out!.text());
    expect(data.ratio).toBeCloseTo(data.tokens / data.characters, 2);
  });

  it('rejects empty input array', async () => {
    await expect(tokenCount.run([], {}, makeCtx())).rejects.toThrow();
  });
});
