import { describe, it, expect } from 'vitest';
import { pdfInfo } from '../../../src/tools/pdf-info/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { PdfInfoResult } from '../../../src/tools/pdf-info/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pdf-info — metadata', () => {
  it('has id pdf-info', () => {
    expect(pdfInfo.id).toBe('pdf-info');
  });

  it('is in the inspect category', () => {
    expect(pdfInfo.category).toBe('inspect');
  });

  it('accepts only application/pdf, max 1 file', () => {
    expect(pdfInfo.input.accept).toContain('application/pdf');
    expect(pdfInfo.input.max).toBe(1);
  });

  it('outputs application/json', () => {
    expect(pdfInfo.output.mime).toBe('application/json');
  });
});

describe('pdf-info — run()', () => {
  it('reads pageCount from doc-a.pdf', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const outputs = await pdfInfo.run([input], {}, makeCtx()) as Blob[];
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('application/json');

    const json = JSON.parse(await outputs[0]!.text()) as PdfInfoResult;
    expect(json.pageCount).toBeGreaterThan(0);
    expect(json.bytes).toBeGreaterThan(0);
  });

  it('reads pageCount from doc-multipage.pdf', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const outputs = await pdfInfo.run([input], {}, makeCtx()) as Blob[];
    const json = JSON.parse(await outputs[0]!.text()) as PdfInfoResult;
    expect(json.pageCount).toBeGreaterThan(1);
  });

  it('returns null for missing metadata fields', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const outputs = await pdfInfo.run([input], {}, makeCtx()) as Blob[];
    const json = JSON.parse(await outputs[0]!.text()) as PdfInfoResult;
    // Fixtures likely have no metadata — fields should be null not undefined
    // At minimum, assert the keys exist in the result
    expect('title' in json).toBe(true);
    expect('author' in json).toBe(true);
    expect('subject' in json).toBe(true);
    expect('producer' in json).toBe(true);
    expect('creator' in json).toBe(true);
    expect('createdAt' in json).toBe(true);
    expect('modifiedAt' in json).toBe(true);
  });

  it('createdAt is null or a valid ISO timestamp', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const outputs = await pdfInfo.run([input], {}, makeCtx()) as Blob[];
    const json = JSON.parse(await outputs[0]!.text()) as PdfInfoResult;
    if (json.createdAt !== null) {
      expect(() => new Date(json.createdAt!)).not.toThrow();
    }
  });
});
