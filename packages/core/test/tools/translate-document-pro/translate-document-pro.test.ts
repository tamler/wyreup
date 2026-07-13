import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  defaultTranslateDocumentProParams,
  translateDocumentPro,
} from '../../../src/tools/translate-document-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const RUNNERS_MODULE = '../../../../../functions/_lib/runners.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'translate-document-pro-test',
  };
}

describe('translate-document-pro', () => {
  it('is registered as a three-credit PDF and text tool', () => {
    const tool = createDefaultRegistry().toolsById.get('translate-document-pro');

    expect(tool).toBeDefined();
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(3);
    expect(tool?.input.accept).toEqual(['application/pdf', 'text/plain']);
  });

  it('rejects input with no readable text using the friendly error', async () => {
    const input = new File([''], 'empty.txt', { type: 'text/plain' });

    await expect(
      translateDocumentPro.run([input], defaultTranslateDocumentProParams, makeCtx()),
    ).rejects.toThrow('No readable text found — scanned PDFs need OCR first.');
  });

  it('chunks on paragraph boundaries without losing content', async () => {
    const { __chunkDocumentText } = (await import(RUNNERS_MODULE)) as {
      __chunkDocumentText: (text: string, maxChars?: number) => string[];
    };
    const text = `${'a'.repeat(30)}\n\n${'b'.repeat(30)}\n\n${'c'.repeat(30)}`;
    const chunks = __chunkDocumentText(text, 45);

    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
    expect(chunks[0]).toBe(`${'a'.repeat(30)}\n\n`);
    expect(chunks.join('')).toBe(text);
  });

  it('does not create a whitespace-only chunk at an exact hard boundary', async () => {
    const { __chunkDocumentText } = (await import(RUNNERS_MODULE)) as {
      __chunkDocumentText: (text: string, maxChars?: number) => string[];
    };
    const text = `${'a'.repeat(45)}\n\n${'b'.repeat(60)}`;
    const chunks = __chunkDocumentText(text, 45);

    expect(chunks.every((chunk) => chunk.trim().length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
});
