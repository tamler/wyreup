/**
 * zip-create tests
 *
 * 1. Metadata — always run.
 * 2. run() — JSZip is pure JS, runs in Node.
 */

import { describe, it, expect } from 'vitest';
import { zipCreate, defaultZipCreateParams } from '../../../src/tools/zip-create/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

function isZip(buf: Uint8Array): boolean {
  // ZIP local file header signature: PK (0x50 0x4B 0x03 0x04)
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

describe('zip-create — metadata', () => {
  it('has id "zip-create"', () => expect(zipCreate.id).toBe('zip-create'));
  it('category is "archive"', () => expect(zipCreate.category).toBe('archive'));
  it('output is application/zip', () => expect(zipCreate.output.mime).toBe('application/zip'));
  it('memoryEstimate is "low"', () => expect(zipCreate.memoryEstimate).toBe('low'));
  it('cost is "free"', () => expect(zipCreate.cost).toBe('free'));
  it('batchable is false', () => expect(zipCreate.batchable).toBe(false));
  it('no installSize', () => expect(zipCreate.installSize).toBeUndefined());
  it('defaults compression is DEFLATE', () => expect(defaultZipCreateParams.compression).toBe('DEFLATE'));
  it('defaults compressionLevel is 6', () => expect(defaultZipCreateParams.compressionLevel).toBe(6));
});

describe('zip-create — run()', () => {
  it('creates a valid ZIP archive from one file', async () => {
    const file = new File(['hello world'], 'hello.txt', { type: 'text/plain' });
    const result = await zipCreate.run([file], defaultZipCreateParams, makeCtx()) as Blob[];
    expect(result).toHaveLength(1);
    const buf = new Uint8Array(await result[0]!.arrayBuffer());
    expect(isZip(buf)).toBe(true);
  });

  it('output blob type is application/zip', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    const result = await zipCreate.run([file], defaultZipCreateParams, makeCtx()) as Blob[];
    expect(result[0]!.type).toBe('application/zip');
  });

  it('creates a ZIP from multiple files', async () => {
    const files = [
      new File(['file one'], 'a.txt', { type: 'text/plain' }),
      new File(['file two'], 'b.txt', { type: 'text/plain' }),
      new File(['file three'], 'c.txt', { type: 'text/plain' }),
    ];
    const result = await zipCreate.run(files, defaultZipCreateParams, makeCtx()) as Blob[];
    const buf = new Uint8Array(await result[0]!.arrayBuffer());
    expect(isZip(buf)).toBe(true);
  });

  it('respects custom filename', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    const result = await zipCreate.run([file], { ...defaultZipCreateParams, filename: 'custom.zip' }, makeCtx()) as Blob[];
    // File name is set on the File object
    const outFile = result[0] as File;
    expect(outFile.name).toBe('custom.zip');
  });

  it('STORE compression produces valid ZIP', async () => {
    const file = new File(['uncompressed'], 'u.txt', { type: 'text/plain' });
    const result = await zipCreate.run([file], { compression: 'STORE' }, makeCtx()) as Blob[];
    const buf = new Uint8Array(await result[0]!.arrayBuffer());
    expect(isZip(buf)).toBe(true);
  });
});
