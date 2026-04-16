import { describe, it, expect } from 'vitest';
import { hash } from '../../../src/tools/hash/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { HashFileResult } from '../../../src/tools/hash/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('hash — metadata', () => {
  it('has id hash', () => {
    expect(hash.id).toBe('hash');
  });

  it('is in the inspect category', () => {
    expect(hash.category).toBe('inspect');
  });

  it('accepts any MIME (*/*)', () => {
    expect(hash.input.accept).toContain('*/*');
  });

  it('defaults to SHA-256', () => {
    expect(hash.defaults.algorithms).toContain('SHA-256');
  });
});

describe('hash — run()', () => {
  it('computes a SHA-256 hash of photo.jpg', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await hash.run([input], { algorithms: ['SHA-256'] }, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('application/json');

    const result = JSON.parse(await outputs[0]!.text()) as HashFileResult;
    expect(result.name).toBe('photo.jpg');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.hashes['SHA-256']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SHA-256 hash is stable on repeated calls', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const [out1, out2] = await Promise.all([
      hash.run([input], { algorithms: ['SHA-256'] }, makeCtx()),
      hash.run([input], { algorithms: ['SHA-256'] }, makeCtx()),
    ]);
    const r1 = JSON.parse(await out1[0]!.text()) as HashFileResult;
    const r2 = JSON.parse(await out2[0]!.text()) as HashFileResult;
    expect(r1.hashes['SHA-256']).toBe(r2.hashes['SHA-256']);
  });

  it('supports multiple algorithms in one call', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await hash.run(
      [input],
      { algorithms: ['SHA-256', 'SHA-1', 'SHA-512'] },
      makeCtx(),
    );
    const result = JSON.parse(await outputs[0]!.text()) as HashFileResult;
    expect(result.hashes['SHA-256']).toMatch(/^[0-9a-f]{64}$/);
    expect(result.hashes['SHA-1']).toMatch(/^[0-9a-f]{40}$/);
    expect(result.hashes['SHA-512']).toMatch(/^[0-9a-f]{128}$/);
  });

  it('handles batch inputs and returns an array', async () => {
    const a = loadFixture('photo.jpg', 'image/jpeg');
    const b = loadFixture('doc-a.pdf', 'application/pdf');
    const outputs = await hash.run([a, b], { algorithms: ['SHA-256'] }, makeCtx());
    const result = JSON.parse(await outputs[0]!.text()) as HashFileResult[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]!.name).toBe('photo.jpg');
    expect(result[1]!.name).toBe('doc-a.pdf');
  });

  it('hashes a PDF file without error', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const outputs = await hash.run([input], { algorithms: ['SHA-256'] }, makeCtx());
    const result = JSON.parse(await outputs[0]!.text()) as HashFileResult;
    expect(result.hashes['SHA-256']).toMatch(/^[0-9a-f]{64}$/);
  });
});
