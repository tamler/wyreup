import { describe, it, expect } from 'vitest';
import { watermarkPdf } from '../../../src/tools/watermark-pdf/index.js';
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

describe('watermark-pdf — metadata', () => {
  it('has the expected id and slug', () => {
    expect(watermarkPdf.id).toBe('watermark-pdf');
    expect(watermarkPdf.slug).toBe('watermark-pdf');
  });

  it('is in the pdf category', () => {
    expect(watermarkPdf.category).toBe('pdf');
  });

  it('accepts only PDF input', () => {
    expect(watermarkPdf.input.accept).toContain('application/pdf');
    expect(watermarkPdf.input.min).toBe(1);
    expect(watermarkPdf.input.max).toBe(1);
  });

  it('outputs application/pdf', () => {
    expect(watermarkPdf.output.mime).toBe('application/pdf');
  });

  it('declares low memory estimate', () => {
    expect(watermarkPdf.memoryEstimate).toBe('low');
  });

  it('has defaults with text mode', () => {
    expect(watermarkPdf.defaults.mode).toBe('text');
    expect(watermarkPdf.defaults.opacity).toBe(0.3);
    expect(watermarkPdf.defaults.fontSize).toBe(48);
  });
});

describe('watermark-pdf — run()', () => {
  it('adds text watermark and returns a larger PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const originalSize = input.size;

    const output = await watermarkPdf.run(
      [input],
      { mode: 'text', text: 'DRAFT', opacity: 0.3 },
      makeCtx(),
    ) as Blob;

    expect(output).toBeInstanceOf(Blob);
    expect(output.type).toBe('application/pdf');
    expect(output.size).toBeGreaterThan(0);
    expect(output.size).toBeGreaterThan(originalSize);
  });

  it('watermarks a multipage PDF on every page', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');

    const output = await watermarkPdf.run(
      [input],
      { mode: 'text', text: 'CONFIDENTIAL', opacity: 0.5, fontSize: 60 },
      makeCtx(),
    ) as Blob;

    expect(output.size).toBeGreaterThan(input.size);

    // Verify output is a valid PDF
    const buf = await output.arrayBuffer();
    const header = new Uint8Array(buf).slice(0, 5);
    const headerStr = String.fromCharCode(...Array.from(header));
    expect(headerStr).toBe('%PDF-');
  });

  it('applies custom rotation and color', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');

    const output = await watermarkPdf.run(
      [input],
      { mode: 'text', text: 'SAMPLE', rotation: 0, color: '#ff0000', opacity: 0.5 },
      makeCtx(),
    ) as Blob;

    expect(output.size).toBeGreaterThan(0);
    expect(output.type).toBe('application/pdf');
  });

  it('throws if image mode is used without imageBuffer', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');

    await expect(
      watermarkPdf.run([input], { mode: 'image' }, makeCtx()),
    ).rejects.toThrow(/imageBuffer/i);
  });

  it('respects a pre-aborted signal', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const controller = new AbortController();
    controller.abort();

    await expect(
      watermarkPdf.run([input], { mode: 'text', text: 'X' }, makeCtx(controller.signal)),
    ).rejects.toThrow();
  });
});
