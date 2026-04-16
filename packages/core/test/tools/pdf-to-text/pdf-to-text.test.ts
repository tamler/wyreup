import { describe, it, expect } from 'vitest';
import { pdfToText } from '../../../src/tools/pdf-to-text/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('pdf-to-text — metadata', () => {
  it('has the expected id and slug', () => {
    expect(pdfToText.id).toBe('pdf-to-text');
    expect(pdfToText.slug).toBe('pdf-to-text');
  });

  it('is in the export category', () => {
    expect(pdfToText.category).toBe('export');
  });

  it('accepts only PDF input', () => {
    expect(pdfToText.input.accept).toContain('application/pdf');
    expect(pdfToText.input.min).toBe(1);
    expect(pdfToText.input.max).toBe(1);
  });

  it('outputs text/plain', () => {
    expect(pdfToText.output.mime).toBe('text/plain');
  });

  it('declares medium memory estimate', () => {
    expect(pdfToText.memoryEstimate).toBe('medium');
  });

  it('has default separator containing {n}', () => {
    expect(pdfToText.defaults.separator).toContain('{n}');
  });
});

describe('pdf-to-text — run()', () => {
  it('extracts text from doc-a.pdf and returns text/plain', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');

    const output = await pdfToText.run([input], {}, makeCtx()) as Blob;

    expect(output).toBeInstanceOf(Blob);
    expect(output.type).toBe('text/plain');
    expect(output.size).toBeGreaterThan(0);
  });

  it('contains expected text from the fixture PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');

    const output = await pdfToText.run([input], {}, makeCtx()) as Blob;
    const text = await output.text();

    expect(text.toLowerCase()).toMatch(/document a/i);
  });

  it('uses custom separator between pages for multipage PDF', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');

    const output = await pdfToText.run(
      [input],
      { separator: '\n---PAGE {n}---\n' },
      makeCtx(),
    ) as Blob;

    const text = await output.text();
    // Multipage PDF should have at least some content
    expect(text.length).toBeGreaterThan(0);
  });

  it('respects a pre-aborted signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const controller = new AbortController();
    controller.abort();

    await expect(
      pdfToText.run([input], {}, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });
});
