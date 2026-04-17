import { describe, it, expect } from 'vitest';
import { pdfToImage } from '../../../src/tools/pdf-to-image/index.js';
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

describe('pdf-to-image — metadata', () => {
  it('has id pdf-to-image', () => {
    expect(pdfToImage.id).toBe('pdf-to-image');
  });

  it('is in the convert category', () => {
    expect(pdfToImage.category).toBe('convert');
  });

  it('accepts application/pdf', () => {
    expect(pdfToImage.input.accept).toContain('application/pdf');
  });

  it('allows only 1 input', () => {
    expect(pdfToImage.input.min).toBe(1);
    expect(pdfToImage.input.max).toBe(1);
  });

  it('outputs image/png', () => {
    expect(pdfToImage.output.mime).toBe('image/png');
  });
});

describe('pdf-to-image — run()', () => {
  it('renders doc-a.pdf to at least one PNG', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const outputs = await pdfToImage.run([input], { dpi: 72 }, makeCtx());
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    expect(outputs[0]!.type).toBe('image/png');
    expect(outputs[0]!.size).toBeGreaterThan(0);
  });

  it('renders all pages of doc-multipage.pdf', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const outputs = await pdfToImage.run([input], { dpi: 72, pages: 'all' }, makeCtx());
    expect(outputs.length).toBeGreaterThanOrEqual(2);
    for (const out of outputs) {
      expect(out.type).toBe('image/png');
      expect(out.size).toBeGreaterThan(0);
    }
  });

  it('renders only selected pages when pages param is set', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const outputs = await pdfToImage.run([input], { dpi: 72, pages: '1' }, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/png');
  });

  it('throws for invalid page number', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfToImage.run([input], { pages: '999' }, makeCtx()),
    ).rejects.toThrow(/out of range/i);
  });
});
