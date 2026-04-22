/**
 * zip-extract tests
 *
 * 1. Metadata — always run.
 * 2. shouldInclude (pure glob helper) — always run.
 * 3. run() — JSZip is pure JS, runs in Node.
 */

import { describe, it, expect } from 'vitest';
import { zipExtract, defaultZipExtractParams, shouldInclude } from '../../../src/tools/zip-extract/index.js';
import { zipCreate } from '../../../src/tools/zip-create/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function makeZip(files: { name: string; content: string }[]): Promise<File> {
  const fileObjs = files.map(({ name, content }) =>
    new File([content], name, { type: 'text/plain' }),
  );
  const result = await zipCreate.run(fileObjs, { compression: 'DEFLATE' }, makeCtx()) as Blob[];
  return new File([await result[0]!.arrayBuffer()], 'archive.zip', { type: 'application/zip' });
}

describe('zip-extract — metadata', () => {
  it('has id "zip-extract"', () => expect(zipExtract.id).toBe('zip-extract'));
  it('category is "archive"', () => expect(zipExtract.category).toBe('archive'));
  it('accepts application/zip', () => expect(zipExtract.input.accept).toContain('application/zip'));
  it('output is multiple', () => expect(zipExtract.output.multiple).toBe(true));
  it('memoryEstimate is "low"', () => expect(zipExtract.memoryEstimate).toBe('low'));
  it('cost is "free"', () => expect(zipExtract.cost).toBe('free'));
  it('batchable is false', () => expect(zipExtract.batchable).toBe(false));
  it('no installSize', () => expect(zipExtract.installSize).toBeUndefined());
});

describe('zip-extract — shouldInclude()', () => {
  it('includes all when filter is undefined', () => expect(shouldInclude('file.txt', undefined)).toBe(true));
  it('includes all when filter is empty', () => expect(shouldInclude('file.txt', '')).toBe(true));
  it('matches exact name', () => expect(shouldInclude('file.txt', 'file.txt')).toBe(true));
  it('matches wildcard *.txt', () => expect(shouldInclude('hello.txt', '*.txt')).toBe(true));
  it('does not match different extension', () => expect(shouldInclude('hello.png', '*.txt')).toBe(false));
});

describe('zip-extract — run()', () => {
  it('extracts files from a ZIP', async () => {
    const zip = await makeZip([
      { name: 'a.txt', content: 'file a' },
      { name: 'b.txt', content: 'file b' },
    ]);
    const result = await zipExtract.run([zip], defaultZipExtractParams, makeCtx()) as Blob[];
    expect(result.length).toBe(2);
  });

  it('extracted content matches original', async () => {
    const zip = await makeZip([{ name: 'hello.txt', content: 'hello world' }]);
    const result = await zipExtract.run([zip], defaultZipExtractParams, makeCtx()) as Blob[];
    const text = await result[0]!.text();
    expect(text).toBe('hello world');
  });

  it('filter reduces extracted files', async () => {
    const zip = await makeZip([
      { name: 'a.txt', content: 'text' },
      { name: 'b.png', content: 'image' },
    ]);
    const result = await zipExtract.run([zip], { filter: '*.txt' }, makeCtx()) as Blob[];
    expect(result.length).toBe(1);
  });

  it('throws when no entries match filter', async () => {
    const zip = await makeZip([{ name: 'a.txt', content: 'text' }]);
    await expect(
      zipExtract.run([zip], { filter: '*.mp4' }, makeCtx()),
    ).rejects.toThrow(/no files found/i);
  });
});
