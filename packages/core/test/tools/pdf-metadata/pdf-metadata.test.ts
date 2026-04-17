import { describe, it, expect } from 'vitest';
import { pdfMetadata } from '../../../src/tools/pdf-metadata/index.js';
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

describe('pdf-metadata — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfMetadata.id).toBe('pdf-metadata');
    expect(pdfMetadata.category).toBe('edit');
  });
});

describe('pdf-metadata — run() mode: read', () => {
  it('returns JSON with metadata fields', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfMetadata.run([input], { mode: 'read' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/json');

    const json = JSON.parse(await blob.text());
    expect(json).toHaveProperty('title');
    expect(json).toHaveProperty('author');
    expect(json).toHaveProperty('keywords');
    expect(Array.isArray(json.keywords)).toBe(true);
  });
});

describe('pdf-metadata — run() mode: write', () => {
  it('updates the title and returns a PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfMetadata.run(
      [input],
      { mode: 'write', metadata: { title: 'My Test Title', author: 'Tester' } },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');

    // Read back to verify
    const readResult = await pdfMetadata.run(
      [new File([await blob.arrayBuffer()], 'out.pdf', { type: 'application/pdf' })],
      { mode: 'read' },
      makeCtx(),
    );
    const readBlob = Array.isArray(readResult) ? readResult[0]! : readResult;
    const json = JSON.parse(await readBlob.text());
    expect(json.title).toBe('My Test Title');
    expect(json.author).toBe('Tester');
  });

  it('throws if metadata is missing in write mode', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfMetadata.run([input], { mode: 'write' }, makeCtx()),
    ).rejects.toThrow('metadata is required');
  });
});

describe('pdf-metadata — run() mode: strip', () => {
  it('strips all metadata fields', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    // First write some metadata
    const written = await pdfMetadata.run(
      [input],
      { mode: 'write', metadata: { title: 'Strip Me', author: 'Test' } },
      makeCtx(),
    );
    const writtenBlob = Array.isArray(written) ? written[0]! : written;

    const stripped = await pdfMetadata.run(
      [new File([await writtenBlob.arrayBuffer()], 'out.pdf', { type: 'application/pdf' })],
      { mode: 'strip' },
      makeCtx(),
    );
    const strippedBlob = Array.isArray(stripped) ? stripped[0]! : stripped;
    expect(strippedBlob.type).toBe('application/pdf');
  });
});
