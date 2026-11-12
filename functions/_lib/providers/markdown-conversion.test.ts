import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { convertDocumentToMarkdown } from './markdown-conversion';

describe('Markdown conversion provider', () => {
  afterEach(() => vi.useRealTimers());
  it('sends a synthesized name and MIME with explicit options and returns plain Markdown', async () => {
    const toMarkdown = vi.fn((_document: { name: string; blob: Blob }, _options: unknown) => Promise.resolve({
      name: 'document.pdf',
      format: 'markdown',
      mimetype: 'application/pdf',
      data: '# Heading\n\nContent',
    }));
    const env = { AI: { toMarkdown } } as unknown as Env;
    const bytes = new TextEncoder().encode('%PDF-1.7');
    await expect(convertDocumentToMarkdown(env, 'pdf', bytes)).resolves.toEqual({
      markdown: '# Heading\n\nContent',
    });
    expect(toMarkdown).toHaveBeenCalledTimes(1);
    const [document, options] = toMarkdown.mock.calls[0];
    expect(document.name).toBe('document.pdf');
    expect(document.blob.type).toBe('application/pdf');
    expect(new Uint8Array(await document.blob.arrayBuffer())).toEqual(bytes);
    expect(options).toEqual({
      conversionOptions: { output: { format: 'markdown' }, pdf: { metadata: false } },
    });
  });

  it.each([
    null,
    [],
    { format: 'error', error: 'internal confidential detail' },
    { format: 'text', mimetype: 'text/html', data: 'text' },
    { format: 'markdown', mimetype: 'text/html', data: 'x'.repeat(1024 * 1024 + 1) },
  ])('rejects unexpected or oversized provider response %# without leaking details', async result => {
    const env = { AI: { toMarkdown: vi.fn().mockResolvedValue(result) } } as unknown as Env;
    await expect(convertDocumentToMarkdown(env, 'html', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'conversion_failed',
      message: 'conversion_failed',
    });
  });

  it('reports an empty conversion distinctly', async () => {
    const env = {
      AI: { toMarkdown: vi.fn().mockResolvedValue({ format: 'markdown', mimetype: 'text/html', data: '  ' }) },
    } as unknown as Env;
    await expect(convertDocumentToMarkdown(env, 'html', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'no_extractable_text',
    });
  });

  it('does not reveal upstream exception text', async () => {
    const env = {
      AI: { toMarkdown: vi.fn().mockRejectedValue(new Error('private document text')) },
    } as unknown as Env;
    await expect(convertDocumentToMarkdown(env, 'html', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'conversion_failed',
      message: 'conversion_failed',
    });
  });

  it('fails before provider work for invalid kinds and sizes', async () => {
    const toMarkdown = vi.fn();
    const env = { AI: { toMarkdown } } as unknown as Env;
    await expect(convertDocumentToMarkdown(env, '__proto__' as 'pdf', new Uint8Array([1])))
      .rejects.toMatchObject({ code: 'conversion_failed' });
    await expect(convertDocumentToMarkdown(env, 'html', new Uint8Array()))
      .rejects.toMatchObject({ code: 'conversion_failed' });
    await expect(convertDocumentToMarkdown(env, 'html', new Uint8Array(10 * 1024 * 1024 + 1)))
      .rejects.toMatchObject({ code: 'conversion_failed' });
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it('reports an unavailable binding', async () => {
    const env = { AI: {} } as unknown as Env;
    await expect(convertDocumentToMarkdown(env, 'html', new Uint8Array([1])))
      .rejects.toMatchObject({ code: 'unavailable' });
  });

  it('fails when the provider exceeds the deadline', async () => {
    vi.useFakeTimers();
    const env = { AI: { toMarkdown: vi.fn(() => new Promise(() => {})) } } as unknown as Env;
    const result = convertDocumentToMarkdown(env, 'html', new Uint8Array([1]));
    const assertion = expect(result).rejects.toMatchObject({ code: 'conversion_failed' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});
