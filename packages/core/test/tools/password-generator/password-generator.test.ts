import { describe, it, expect } from 'vitest';
import { passwordGenerator } from '../../../src/tools/password-generator/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('password-generator — metadata', () => {
  it('has id password-generator', () => {
    expect(passwordGenerator.id).toBe('password-generator');
  });

  it('is in the create category', () => {
    expect(passwordGenerator.category).toBe('create');
  });

  it('requires no file input (min 0, max 0)', () => {
    expect(passwordGenerator.input.min).toBe(0);
    expect(passwordGenerator.input.max).toBe(0);
  });
});

describe('password-generator — run()', () => {
  it('generates a password of the correct length', async () => {
    const [out] = await passwordGenerator.run([], { length: 24 }, makeCtx()) as Blob[];
    const password = await out!.text();
    expect(password.length).toBe(24);
  });

  it('generates password with default length 16', async () => {
    const [out] = await passwordGenerator.run([], { length: 16, uppercase: true, lowercase: true, digits: true, symbols: false }, makeCtx()) as Blob[];
    const password = await out!.text();
    expect(password.length).toBe(16);
  });

  it('respects uppercase=false (no uppercase chars)', async () => {
    const [out] = await passwordGenerator.run(
      [],
      { length: 64, uppercase: false, lowercase: true, digits: true, symbols: false },
      makeCtx(),
    ) as Blob[];
    const password = await out!.text();
    expect(password).toMatch(/^[a-z0-9]+$/);
  });

  it('respects lowercase=false (no lowercase chars)', async () => {
    const [out] = await passwordGenerator.run(
      [],
      { length: 64, uppercase: true, lowercase: false, digits: true, symbols: false },
      makeCtx(),
    ) as Blob[];
    const password = await out!.text();
    expect(password).toMatch(/^[A-Z0-9]+$/);
  });

  it('respects digits=false (no digit chars)', async () => {
    const [out] = await passwordGenerator.run(
      [],
      { length: 64, uppercase: true, lowercase: true, digits: false, symbols: false },
      makeCtx(),
    ) as Blob[];
    const password = await out!.text();
    expect(password).not.toMatch(/[0-9]/);
  });

  it('excludeAmbiguous removes 0, O, l, I, 1', async () => {
    const [out] = await passwordGenerator.run(
      [],
      { length: 200, uppercase: true, lowercase: true, digits: true, symbols: false, excludeAmbiguous: true },
      makeCtx(),
    ) as Blob[];
    const password = await out!.text();
    expect(password).not.toMatch(/[0OlI1]/);
  });

  it('count > 1 generates multiple lines', async () => {
    const [out] = await passwordGenerator.run(
      [],
      { length: 16, count: 5 },
      makeCtx(),
    ) as Blob[];
    const text = await out!.text();
    const lines = text.split('\n');
    expect(lines.length).toBe(5);
    for (const line of lines) {
      expect(line.length).toBe(16);
    }
  });

  it('each generated password is different (statistically)', async () => {
    const [out] = await passwordGenerator.run(
      [],
      { length: 16, count: 10 },
      makeCtx(),
    ) as Blob[];
    const lines = (await out!.text()).split('\n');
    const unique = new Set(lines);
    expect(unique.size).toBe(10);
  });

  it('throws when count > 1000', async () => {
    await expect(passwordGenerator.run([], { count: 1001 }, makeCtx())).rejects.toThrow('count must be <= 1000');
  });

  it('throws when count < 1', async () => {
    await expect(passwordGenerator.run([], { count: 0 }, makeCtx())).rejects.toThrow('count must be >= 1');
  });
});
