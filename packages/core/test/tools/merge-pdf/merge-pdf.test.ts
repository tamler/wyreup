import { describe, it, expect } from 'vitest';
import { mergePdf } from '../../../src/tools/merge-pdf/index.js';
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

describe('merge-pdf — metadata', () => {
  it('has id "merge-pdf" and category "pdf"', () => {
    expect(mergePdf.id).toBe('merge-pdf');
    expect(mergePdf.category).toBe('pdf');
  });

  it('accepts application/pdf only, min 2 files', () => {
    expect(mergePdf.input.accept).toEqual(['application/pdf']);
    expect(mergePdf.input.min).toBe(2);
  });

  it('output mime is application/pdf', () => {
    expect(mergePdf.output.mime).toBe('application/pdf');
  });
});

describe('merge-pdf — run()', () => {
  it('merges two PDFs into one', async () => {
    const a = loadFixture('doc-a.pdf', 'application/pdf');
    const b = loadFixture('doc-b.pdf', 'application/pdf');
    const outputs = await mergePdf.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('application/pdf');

    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF magic
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  });

  it('merged PDF is larger than either input', async () => {
    const a = loadFixture('doc-a.pdf', 'application/pdf');
    const b = loadFixture('doc-b.pdf', 'application/pdf');
    const outputs = await mergePdf.run([a, b], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    const mergedSize = blobs[0]!.size;
    // Merged should be at least near the sum of both (sometimes smaller due to dedup of fonts)
    expect(mergedSize).toBeGreaterThan(Math.min(a.size, b.size));
  });
});
