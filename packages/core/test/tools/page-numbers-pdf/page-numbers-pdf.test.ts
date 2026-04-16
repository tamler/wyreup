import { describe, it, expect } from 'vitest';
import { pageNumbersPdf } from '../../../src/tools/page-numbers-pdf/index.js';
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

describe('page-numbers-pdf — metadata', () => {
  it('has id "page-numbers-pdf" and category "pdf"', () => {
    expect(pageNumbersPdf.id).toBe('page-numbers-pdf');
    expect(pageNumbersPdf.category).toBe('pdf');
  });

  it('accepts application/pdf only, min 1, max 1', () => {
    expect(pageNumbersPdf.input.accept).toEqual(['application/pdf']);
    expect(pageNumbersPdf.input.min).toBe(1);
    expect(pageNumbersPdf.input.max).toBe(1);
  });

  it('output mime is application/pdf', () => {
    expect(pageNumbersPdf.output.mime).toBe('application/pdf');
  });
});

describe('page-numbers-pdf — run()', () => {
  it('adds page numbers and output is a valid PDF larger than input', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pageNumbersPdf.run(
      [input],
      { position: 'bottom-center', fontSize: 12, startAt: 1, format: '{n}' },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(input.size);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF magic
  });

  it('respects startAt: 5 — output size greater than input', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pageNumbersPdf.run(
      [input],
      { position: 'bottom-center', startAt: 5 },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.size).toBeGreaterThan(input.size);
  });

  it('respects custom format "Page {n}" — output differs from default format', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const [defaultResult, customResult] = await Promise.all([
      pageNumbersPdf.run([input], { position: 'bottom-center', format: '{n}' }, makeCtx()),
      pageNumbersPdf.run([input], { position: 'bottom-center', format: 'Page {n}' }, makeCtx()),
    ]);
    const defaultBlob = Array.isArray(defaultResult) ? defaultResult[0]! : defaultResult;
    const customBlob = Array.isArray(customResult) ? customResult[0]! : customResult;
    // Custom format "Page {n}" produces more text, so typically a larger file
    expect(customBlob.size).toBeGreaterThan(defaultBlob.size);
  });

  it('works with top-right position', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pageNumbersPdf.run(
      [input],
      { position: 'top-right' },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(input.size);
  });

  it('throws for unknown position', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pageNumbersPdf.run([input], { position: 'middle' as any }, makeCtx()),
    ).rejects.toThrow();
  });
});
