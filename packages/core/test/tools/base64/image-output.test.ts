import { describe, expect, it } from 'vitest';
import { base64 } from '../../../src/tools/base64/index';
import type { ToolRunContext } from '../../../src/types';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const png = new Uint8Array(Buffer.from(PNG, 'base64'));
const ctx = (): ToolRunContext => ({
  onProgress() {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'base64-image',
});
async function run(
  bytes: Uint8Array = png,
  type = 'image/png',
  params: Record<string, unknown> = {},
) {
  const out = await base64.run(
    [new File([bytes as Uint8Array<ArrayBuffer>], 'image.bin', { type })],
    { mode: 'encode', encodeOutput: 'data-url', ...params },
    ctx(),
  );
  return Array.isArray(out) ? out[0]! : out;
}
describe('image Base64 outputs', () => {
  it('encodes complete valid PNG bytes as a standard data URL and safe CSS URL', async () => {
    const data = await run();
    expect(data.type).toBe('text/plain');
    expect(await data.text()).toBe('data:image/png;base64,' + PNG);
    expect(await (await run(png, 'image/png', { encodeOutput: 'css-url' })).text()).toBe(
      'url("data:image/png;base64,' + PNG + '")',
    );
    const decoded = await base64.run(
      [new File([await data.text()], 'url.txt')],
      { mode: 'decode' },
      ctx(),
    );
    expect(
      new Uint8Array(await (Array.isArray(decoded) ? decoded[0]! : decoded).arrayBuffer()),
    ).toEqual(png);
  });
  it.each(['', 'application/octet-stream'])(
    'sniffs MIME for an unspecified image type %s',
    async (type) => {
      expect(await (await run(png, type)).text()).toBe('data:image/png;base64,' + PNG);
    },
  );
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [new TextEncoder().encode('GIF89a'), 'image/gif'],
    [new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]), 'image/webp'],
  ] as const)(
    'recognizes a supported signature without claiming image validation',
    async (bytes, mime) => {
      expect(await (await run(bytes, '')).text()).toBe(
        'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64'),
      );
    },
  );
  it.each(['image/jpeg', 'text/html', 'image/svg+xml'])(
    'rejects a MIME/signature mismatch %s',
    async (type) => {
      await expect(run(png, type)).rejects.toThrow('MIME');
    },
  );
  it.each(['<svg></svg>', '%PDF-1.7', '<html>', 'not an image'])(
    'rejects unsupported bytes %s',
    async (text) => {
      await expect(run(new TextEncoder().encode(text), '')).rejects.toThrow(
        'PNG, JPEG, GIF or WebP',
      );
    },
  );
  it('enforces standard alphabet, encode-only modes and the 5 MiB image limit', async () => {
    await expect(run(png, 'image/png', { urlSafe: true })).rejects.toThrow('URL-safe');
    await expect(run(png, 'image/png', { mode: 'decode' })).rejects.toThrow('encode');
    await expect(run(png, 'image/png', { encodeOutput: 'unknown' })).rejects.toThrow('output');
    await expect(run(new Uint8Array(5 * 1024 * 1024 + 1), '')).rejects.toThrow('5 MiB');
  });
  it('keeps raw arbitrary-file encoding unchanged and allows larger downloadable output', async () => {
    expect(
      await (await run(new Uint8Array([0, 255]), 'text/plain', { encodeOutput: 'raw' })).text(),
    ).toBe('AP8=');
    const large = new Uint8Array(200000);
    large.set(png);
    expect((await run(large)).size).toBe(22 + Math.ceil(large.length / 3) * 4);
  });
  it('respects cancellation without emitting done', async () => {
    const controller = new AbortController();
    controller.abort();
    const stages: string[] = [];
    await expect(
      base64.run(
        [new File([png], 'image.png', { type: 'image/png' })],
        { mode: 'encode', encodeOutput: 'data-url' },
        { ...ctx(), signal: controller.signal, onProgress: (p) => stages.push(p.stage) },
      ),
    ).rejects.toThrow('Aborted');
    expect(stages).not.toContain('done');
  });
});
