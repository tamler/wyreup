import { describe, it, expect } from 'vitest';
import { base64 } from '../../../src/tools/base64/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('base64 — metadata', () => {
  it('has id base64', () => {
    expect(base64.id).toBe('base64');
  });

  it('is in the convert category', () => {
    expect(base64.category).toBe('convert');
  });

  it('accepts */*', () => {
    expect(base64.input.accept).toContain('*/*');
  });

  it('defaults to encode mode', () => {
    expect(base64.defaults.mode).toBe('encode');
  });
});

describe('base64 — run()', () => {
  it('encodes a small text file to base64', async () => {
    const input = new File(['Hello, World!'], 'test.txt', { type: 'text/plain' });
    const [out] = await base64.run([input], { mode: 'encode' }, makeCtx()) as Blob[];
    expect(out!.type).toBe('text/plain');
    const encoded = await out!.text();
    expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
  });

  it('round-trips encode then decode to identical bytes', async () => {
    const original = 'The quick brown fox jumps over the lazy dog';
    const input = new File([original], 'test.txt', { type: 'text/plain' });

    const [encoded] = await base64.run([input], { mode: 'encode' }, makeCtx()) as Blob[];
    const encodedFile = new File([await encoded!.text()], 'encoded.txt', { type: 'text/plain' });

    const [decoded] = await base64.run([encodedFile], { mode: 'decode' }, makeCtx()) as Blob[];
    const decodedText = await decoded!.text();
    expect(decodedText).toBe(original);
  });

  it('handles URL-safe variant (no +/= chars)', async () => {
    // Use bytes that produce +/= in standard base64
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xfb]);
    const input = new File([bytes], 'binary.bin', { type: 'application/octet-stream' });
    const [out] = await base64.run([input], { mode: 'encode', urlSafe: true }, makeCtx()) as Blob[];
    const encoded = await out!.text();
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('strips data URL prefix on decode', async () => {
    const dataUrl = 'data:text/plain;base64,SGVsbG8h';
    const input = new File([dataUrl], 'data.txt', { type: 'text/plain' });
    const [out] = await base64.run([input], { mode: 'decode' }, makeCtx()) as Blob[];
    const text = await out!.text();
    expect(text).toBe('Hello!');
  });

  it('handles binary files (not just text)', async () => {
    const binary = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 252]);
    const input = new File([binary], 'binary.bin', { type: 'application/octet-stream' });

    const [encoded] = await base64.run([input], { mode: 'encode' }, makeCtx()) as Blob[];
    const encodedFile = new File([await encoded!.text()], 'encoded.txt', { type: 'text/plain' });

    const [decoded] = await base64.run([encodedFile], { mode: 'decode' }, makeCtx()) as Blob[];
    const decodedBuffer = await decoded!.arrayBuffer();
    const decodedBytes = new Uint8Array(decodedBuffer);
    expect(decodedBytes).toEqual(binary);
  });
});
