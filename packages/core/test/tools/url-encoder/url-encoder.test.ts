import { describe, it, expect } from 'vitest';
import { urlEncoder } from '../../../src/tools/url-encoder/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('url-encoder — metadata', () => {
  it('has id url-encoder', () => {
    expect(urlEncoder.id).toBe('url-encoder');
  });

  it('is in the convert category', () => {
    expect(urlEncoder.category).toBe('convert');
  });

  it('accepts text/plain', () => {
    expect(urlEncoder.input.accept).toContain('text/plain');
  });

  it('defaults to encode/component', () => {
    expect(urlEncoder.defaults.mode).toBe('encode');
    expect(urlEncoder.defaults.scope).toBe('component');
  });
});

describe('url-encoder — run()', () => {
  it('encodes special characters in component mode', async () => {
    const input = new File(['hello world & foo=bar'], 'test.txt', { type: 'text/plain' });
    const [out] = await urlEncoder.run([input], { mode: 'encode', scope: 'component' }, makeCtx());
    const encoded = await out!.text();
    expect(encoded).toBe('hello%20world%20%26%20foo%3Dbar');
  });

  it('round-trips encode then decode', async () => {
    const original = 'name=John Doe&city=New York&special=!@#$';
    const input = new File([original], 'test.txt', { type: 'text/plain' });

    const [encoded] = await urlEncoder.run([input], { mode: 'encode', scope: 'component' }, makeCtx());
    const encodedFile = new File([await encoded!.text()], 'encoded.txt', { type: 'text/plain' });

    const [decoded] = await urlEncoder.run([encodedFile], { mode: 'decode', scope: 'component' }, makeCtx());
    expect(await decoded!.text()).toBe(original);
  });

  it('full mode preserves URL structure characters', async () => {
    const url = 'https://example.com/path?query=value&other=test';
    const input = new File([url], 'test.txt', { type: 'text/plain' });
    const [out] = await urlEncoder.run([input], { mode: 'encode', scope: 'full' }, makeCtx());
    const encoded = await out!.text();
    // In full mode, :/?&= are preserved
    expect(encoded).toContain('https://');
    expect(encoded).toContain('?');
    expect(encoded).toContain('&');
    expect(encoded).toContain('=');
  });

  it('handles Unicode characters', async () => {
    const input = new File(['こんにちは'], 'test.txt', { type: 'text/plain' });
    const [out] = await urlEncoder.run([input], { mode: 'encode', scope: 'component' }, makeCtx());
    const encoded = await out!.text();
    expect(encoded).toContain('%');
    // Decode it back
    const encodedFile = new File([encoded], 'encoded.txt', { type: 'text/plain' });
    const [decoded] = await urlEncoder.run([encodedFile], { mode: 'decode', scope: 'component' }, makeCtx());
    expect(await decoded!.text()).toBe('こんにちは');
  });
});
