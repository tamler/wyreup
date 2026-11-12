import { describe, expect, it, vi } from 'vitest';
import { textToSpeechPro } from '../../src/tools/text-to-speech-pro/index.js';
import { fixGrammarPro } from '../../src/tools/fix-grammar-pro/index.js';
import { deepAnalysisPro } from '../../src/tools/deep-analysis-pro/index.js';
import type { ToolRunContext } from '../../src/types.js';

const ctx: ToolRunContext = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map<string, unknown>(),
  executionId: 'test',
  apiKey: 'test-key',
};

describe('Pro migration client preflight', () => {
  it('rejects unavailable speech languages before a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(textToSpeechPro.run([new File(['bonjour'], 'a.txt')], { language: 'FR' }, ctx)).rejects.toThrow(/currently unavailable/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('rejects byte and normalized-byte overruns before a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(textToSpeechPro.run([new File(['é'.repeat(251)], 'a.txt')], {}, ctx)).rejects.toThrow(/500-byte/);
      await expect(fixGrammarPro.run([new File(['ﬃ'.repeat(1334)], 'a.txt')], {}, ctx)).rejects.toThrow(/4000-byte/);
      await expect(deepAnalysisPro.run([new File(['text'], 'a.txt')], { question: 'a'.repeat(1501) }, ctx)).rejects.toThrow(/1500-byte/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
});
