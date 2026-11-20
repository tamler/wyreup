import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  defaultTranslateDocumentProParams,
  translateDocumentPro,
} from '../../../src/tools/translate-document-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

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
});
