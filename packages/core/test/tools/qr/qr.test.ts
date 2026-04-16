import { describe, it, expect } from 'vitest';
import { qr } from '../../../src/tools/qr/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('qr — metadata', () => {
  it('has the expected id and slug', () => {
    expect(qr.id).toBe('qr');
    expect(qr.slug).toBe('qr');
  });

  it('is in the create category', () => {
    expect(qr.category).toBe('create');
  });

  it('accepts no input files', () => {
    expect(qr.input.min).toBe(0);
    expect(qr.input.max).toBe(0);
  });

  it('outputs image/png', () => {
    expect(qr.output.mime).toBe('image/png');
  });

  it('declares low memory estimate', () => {
    expect(qr.memoryEstimate).toBe('low');
  });

  it('defaults size to 300', () => {
    expect(qr.defaults.size).toBe(300);
  });
});

describe('qr — run()', () => {
  it('generates a valid PNG for a URL', async () => {
    const output = await qr.run(
      [],
      { text: 'https://example.com' },
      makeCtx(),
    ) as Blob;

    expect(output).toBeInstanceOf(Blob);
    expect(output.type).toBe('image/png');
    expect(output.size).toBeGreaterThan(100);

    // Verify PNG signature bytes: 0x89 P N G
    const buf = await output.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x4e); // N
    expect(bytes[3]).toBe(0x47); // G
  });

  it('generates a larger PNG for a larger size', async () => {
    const small = await qr.run([], { text: 'hello', size: 100 }, makeCtx()) as Blob;
    const large = await qr.run([], { text: 'hello', size: 400 }, makeCtx()) as Blob;

    expect(large.size).toBeGreaterThan(small.size);
  });

  it('accepts custom foreground and background colors', async () => {
    const output = await qr.run(
      [],
      { text: 'test', foregroundColor: '#003366', backgroundColor: '#ffffcc' },
      makeCtx(),
    ) as Blob;

    expect(output.size).toBeGreaterThan(100);
    expect(output.type).toBe('image/png');
  });

  it('throws when text is empty', async () => {
    await expect(
      qr.run([], { text: '' }, makeCtx()),
    ).rejects.toThrow(/text/i);
  });

  it('respects a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      qr.run([], { text: 'hello' }, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });
});
