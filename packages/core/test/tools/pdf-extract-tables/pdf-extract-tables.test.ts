import { describe, it, expect } from 'vitest';
import { pdfExtractTables } from '../../../src/tools/pdf-extract-tables/index.js';
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

describe('pdf-extract-tables — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfExtractTables.id).toBe('pdf-extract-tables');
    expect(pdfExtractTables.category).toBe('export');
  });

  it('output mime is application/json by default', () => {
    expect(pdfExtractTables.output.mime).toBe('application/json');
  });

  it('description mentions limitations', () => {
    expect(pdfExtractTables.description.toLowerCase()).toContain('complex');
  });
});

describe('pdf-extract-tables — run()', () => {
  it('returns JSON with page and rows structure', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfExtractTables.run([input], { format: 'json' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/json');

    const json = JSON.parse(await blob.text()) as Array<{ page: number; rows: unknown[] }>;
    expect(Array.isArray(json)).toBe(true);
    expect(json[0]).toHaveProperty('page');
    expect(json[0]).toHaveProperty('rows');
    expect(Array.isArray(json[0]!.rows)).toBe(true);
  });

  it('returns CSV when format is csv', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfExtractTables.run([input], { format: 'csv' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('text/csv');
  });

  it('respects page param (returns only that page)', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfExtractTables.run([input], { format: 'json', page: 1 }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const json = JSON.parse(await blob.text()) as Array<{ page: number; rows: unknown[] }>;
    expect(json.length).toBe(1);
    expect(json[0]!.page).toBe(1);
  });

  it('throws for invalid page number', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfExtractTables.run([input], { page: 99 }, makeCtx()),
    ).rejects.toThrow();
  });

  it('respects abort signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfExtractTables.run([input], {}, makeCtx(true)),
    ).rejects.toThrow('Aborted');
  });
});
