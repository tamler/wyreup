import { describe, it, expect } from 'vitest';
import { pdfCompress } from '../../../src/tools/pdf-compress/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(aborted = false): ToolRunContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    onProgress: () => {},
    signal: controller.signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pdf-compress — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfCompress.id).toBe('pdf-compress');
    expect(pdfCompress.category).toBe('optimize');
  });

  it('output mime is application/pdf', () => {
    expect(pdfCompress.output.mime).toBe('application/pdf');
  });

  it('description mentions image re-encoding limitation', () => {
    expect(pdfCompress.description).toContain('re-encoding embedded images');
  });
});

describe('pdf-compress — run()', () => {
  it('processes a PDF without errors (no embedded images)', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfCompress.run([input], {}, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('throws for invalid imageQuality', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfCompress.run([input], { imageQuality: 0 }, makeCtx()),
    ).rejects.toThrow('imageQuality');
  });

  it('respects abort signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfCompress.run([input], {}, makeCtx(true)),
    ).rejects.toThrow('Aborted');
  });
});
