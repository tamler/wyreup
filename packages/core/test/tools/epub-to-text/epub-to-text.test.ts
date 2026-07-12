import { describe, expect, it } from 'vitest';
import { defaultEpubToTextParams, epubToText } from '../../../src/tools/epub-to-text/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(signal?: AbortSignal): ToolRunContext {
  return {
    onProgress: () => {},
    signal: signal ?? new AbortController().signal,
    cache: new Map(),
    executionId: 'test-epub-to-text',
  };
}

describe('epub-to-text — metadata', () => {
  it('declares complete tool metadata', () => {
    expect(epubToText.id).toBe('epub-to-text');
    expect(epubToText.slug).toBe('epub-to-text');
    expect(epubToText.name).toBe('EPUB to Text');
    expect(epubToText.category).toBe('convert');
    expect(epubToText.categories).toEqual(['convert', 'text']);
    expect(epubToText.input.accept).toEqual(['application/epub+zip']);
    expect(epubToText.input.min).toBe(1);
    expect(epubToText.input.max).toBe(1);
    expect(epubToText.output.mime).toBe('text/plain');
    expect(epubToText.interactive).toBe(false);
    expect(epubToText.batchable).toBe(false);
    expect(epubToText.cost).toBe('free');
    expect(epubToText.memoryEstimate).toBe('low');
    expect(epubToText.defaults).toEqual(defaultEpubToTextParams);
    expect(epubToText.__testFixtures).toEqual({
      valid: ['book.epub'],
      weird: [],
      expectedOutputMime: ['text/plain'],
    });
    for (const key of Object.keys(epubToText.defaults)) {
      expect(epubToText.paramSchema, key).toHaveProperty(key);
      expect(epubToText.paramSchema?.[key as keyof typeof epubToText.defaults]?.label).toBeTruthy();
      expect(epubToText.paramSchema?.[key as keyof typeof epubToText.defaults]?.help).toBeTruthy();
    }
  });
});

describe('epub-to-text — run()', () => {
  it('extracts metadata and XHTML text in spine order', async () => {
    const input = loadFixture('book.epub', 'application/epub+zip');
    const output = (await epubToText.run([input], {}, makeCtx())) as Blob;
    const text = await output.text();

    expect(output.type).toBe('text/plain');
    expect(text).toContain('Title: Test Book');
    expect(text).toContain('Author: Wyreup Fixtures');
    expect(text).toContain('the clocks were striking thirteen');
    expect(text).toContain('The hallway smelt of boiled cabbage & old rag mats.');
    expect(text).toContain('The second chapter has emphasis and a link.');
    expect(text.indexOf('Chapter One')).toBeLessThan(text.indexOf('Chapter Two'));
    expect(text).not.toMatch(/<\/?(?:p|em|a)\b/i);
  });

  it('omits book metadata when includeMetadata is false', async () => {
    const input = loadFixture('book.epub', 'application/epub+zip');
    const output = (await epubToText.run([input], { includeMetadata: false }, makeCtx())) as Blob;
    const text = await output.text();

    expect(text).not.toContain('Test Book');
    expect(text).not.toContain('Wyreup Fixtures');
    expect(text).toContain('Chapter One');
  });

  it('rejects a non-ZIP input', async () => {
    const input = new File(['not an epub archive'], 'broken.epub', {
      type: 'application/epub+zip',
    });

    await expect(epubToText.run([input], {}, makeCtx())).rejects.toThrow(/valid ZIP archive/i);
  });

  it('respects a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const input = loadFixture('book.epub', 'application/epub+zip');

    await expect(epubToText.run([input], {}, makeCtx(controller.signal))).rejects.toThrow(
      'Aborted',
    );
  });
});
