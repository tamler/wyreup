import { describe, expect, it } from 'vitest';
import { readJsonObject } from './request';

describe('bounded JSON request parsing', () => {
  it.each(['null', '[]', '"text"', '{'])('rejects invalid object %s', async (body) => {
    await expect(
      readJsonObject(new Request('https://example.com', { method: 'POST', body }), 64),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('counts streamed bytes even with a misleading small length header', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"x":"'));
        controller.enqueue(new Uint8Array(65));
        controller.close();
      },
    });
    const request = new Request('https://example.com', {
      method: 'POST',
      body,
      headers: { 'Content-Length': '1' },
      duplex: 'half',
    } as RequestInit);
    await expect(readJsonObject(request, 64)).rejects.toMatchObject({ status: 413 });
  });
  it('accepts an object at the byte boundary', async () => {
    const body = '{"x":1}';
    await expect(
      readJsonObject(new Request('https://example.com', { method: 'POST', body }), body.length),
    ).resolves.toEqual({ x: 1 });
  });
});
