import { describe, it, expect } from 'vitest';
import { splitPdf } from '../../../src/tools/split-pdf/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('split-pdf — metadata', () => {
  it('has id "split-pdf" and category "pdf"', () => {
    expect(splitPdf.id).toBe('split-pdf');
    expect(splitPdf.category).toBe('pdf');
  });

  it('accepts application/pdf only, min 1, max 1', () => {
    expect(splitPdf.input.accept).toEqual(['application/pdf']);
    expect(splitPdf.input.min).toBe(1);
    expect(splitPdf.input.max).toBe(1);
  });

  it('output mime is application/pdf with multiple: true', () => {
    expect(splitPdf.output.mime).toBe('application/pdf');
    expect((splitPdf.output as any).multiple).toBe(true);
  });
});

describe('split-pdf — run() mode: all', () => {
  it('splits a 3-page PDF into 3 separate PDFs', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await splitPdf.run([input], { mode: 'all' }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs.length).toBe(3);
    for (const blob of blobs) {
      expect(blob.type).toBe('application/pdf');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(bytes[0]).toBe(0x25); // %
      expect(bytes[1]).toBe(0x50); // P
      expect(bytes[2]).toBe(0x44); // D
      expect(bytes[3]).toBe(0x46); // F
    }
  });

  it('each split part is smaller than the original', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await splitPdf.run([input], { mode: 'all' }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    for (const blob of blobs) {
      expect(blob.size).toBeLessThan(input.size);
    }
  });
});

describe('split-pdf — run() mode: ranges', () => {
  it('produces a single PDF for range "1"', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await splitPdf.run([input], { mode: 'ranges', ranges: '1' }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('application/pdf');
  });

  it('produces two PDFs for ranges "1-2,3"', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await splitPdf.run([input], { mode: 'ranges', ranges: '1-2,3' }, makeCtx());
    const blobs = Array.isArray(result) ? result : [result];
    expect(blobs.length).toBe(2);
  });

  it('throws for an invalid range string', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      splitPdf.run([input], { mode: 'ranges', ranges: 'abc' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('throws for a range exceeding page count', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      splitPdf.run([input], { mode: 'ranges', ranges: '1-99' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('throws when ranges is empty in ranges mode', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    await expect(
      splitPdf.run([input], { mode: 'ranges', ranges: '' }, makeCtx()),
    ).rejects.toThrow();
  });
});
