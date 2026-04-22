/**
 * zip-info tests
 *
 * 1. Metadata — always run.
 * 2. run() — JSZip is pure JS, runs in Node.
 */

import { describe, it, expect } from 'vitest';
import { zipInfo, defaultZipInfoParams } from '../../../src/tools/zip-info/index.js';
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

describe('zip-info — metadata', () => {
  it('has id "zip-info"', () => expect(zipInfo.id).toBe('zip-info'));
  it('category is "archive"', () => expect(zipInfo.category).toBe('archive'));
  it('accepts application/zip', () => expect(zipInfo.input.accept).toContain('application/zip'));
  it('output is application/json', () => expect(zipInfo.output.mime).toBe('application/json'));
  it('memoryEstimate is "low"', () => expect(zipInfo.memoryEstimate).toBe('low'));
  it('cost is "free"', () => expect(zipInfo.cost).toBe('free'));
  it('batchable is false', () => expect(zipInfo.batchable).toBe(false));
  it('no installSize', () => expect(zipInfo.installSize).toBeUndefined());
});

describe('zip-info — run()', () => {
  it('returns JSON output', async () => {
    const zip = await makeZip([{ name: 'hello.txt', content: 'hello' }]);
    const result = await zipInfo.run([zip], defaultZipInfoParams, makeCtx()) as Blob[];
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('application/json');
  });

  it('reports correct entry count', async () => {
    const zip = await makeZip([
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
    ]);
    const result = await zipInfo.run([zip], defaultZipInfoParams, makeCtx()) as Blob[];
    const json = JSON.parse(await result[0]!.text()) as { entries: number };
    expect(json.entries).toBe(2);
  });

  it('lists file paths', async () => {
    const zip = await makeZip([{ name: 'readme.txt', content: 'content' }]);
    const result = await zipInfo.run([zip], defaultZipInfoParams, makeCtx()) as Blob[];
    const json = JSON.parse(await result[0]!.text()) as { files: Array<{ path: string }> };
    const paths = json.files.map((f) => f.path);
    expect(paths).toContain('readme.txt');
  });

  it('compressionRatio is a number', async () => {
    const zip = await makeZip([{ name: 'data.txt', content: 'x'.repeat(1000) }]);
    const result = await zipInfo.run([zip], defaultZipInfoParams, makeCtx()) as Blob[];
    const json = JSON.parse(await result[0]!.text()) as { compressionRatio: number };
    expect(typeof json.compressionRatio).toBe('number');
  });

  it('isDirectory is false for files', async () => {
    const zip = await makeZip([{ name: 'file.txt', content: 'data' }]);
    const result = await zipInfo.run([zip], defaultZipInfoParams, makeCtx()) as Blob[];
    const json = JSON.parse(await result[0]!.text()) as { files: Array<{ isDirectory: boolean }> };
    const files = json.files.filter((f) => !f.isDirectory);
    expect(files.length).toBeGreaterThan(0);
  });
});
