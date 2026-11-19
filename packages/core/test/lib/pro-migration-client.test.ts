import { describe, expect, it, vi } from 'vitest';
import { textToSpeechPro, type TextToSpeechProParams } from '../../src/tools/text-to-speech-pro/index.js';
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
      const legacyParams = JSON.parse('{"language":"FR"}') as TextToSpeechProParams;
      await expect(textToSpeechPro.run([new File(['bonjour'], 'a.txt')], legacyParams, ctx)).rejects.toThrow(/currently unavailable/);
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

  it('preserves a 4,000-byte UTF-8 file in the grammar request and a no-op result', async () => {
    const prefix = '\uFEFF  Cafe\u0301 👩‍💻\r\n漢字\t \r\n';
    const encoder = new TextEncoder();
    const text = prefix + ' '.repeat(4000 - encoder.encode(prefix).length);
    const original = encoder.encode(text);
    const file = new File([original], 'original.txt', { type: 'text/plain' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ result: { corrected: text } }));
    try {
      const result = await fixGrammarPro.run([file], {}, ctx);
      if (!(result instanceof Blob)) throw new Error('Expected a single grammar result');
      expect(result.type).toBe('text/plain');
      expect(new Uint8Array(await result.arrayBuffer())).toEqual(original);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = fetchSpy.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string') throw new Error('Expected a JSON request body');
      const request: unknown = JSON.parse(body);
      expect(request).toEqual({ toolId: 'fix-grammar-pro', input: { text, fileName: file.name } });
    } finally { fetchSpy.mockRestore(); }
  });

  it('rejects invalid UTF-8, whitespace-only files and either grammar byte overrun before dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const oversized = new File([' '.repeat(4000) + 'a'], 'raw.txt');
      const decode = vi.spyOn(oversized, 'arrayBuffer');
      await expect(fixGrammarPro.run([oversized], {}, ctx)).rejects.toThrow(/4000-byte/);
      expect(decode).not.toHaveBeenCalled();

      const normalizedOversize = new File(['㍿'.repeat(334)], 'normalized.txt');
      expect(normalizedOversize.size).toBeLessThan(4000);
      await expect(fixGrammarPro.run([normalizedOversize], {}, ctx)).rejects.toThrow(/4000-byte/);

      const invalid = new File([Uint8Array.of(0xc3, 0x28)], 'invalid.txt');
      await expect(fixGrammarPro.run([invalid], {}, ctx)).rejects.toThrow('Grammar input must be valid UTF-8.');
      await expect(fixGrammarPro.run([new File(['\uFEFF \r\n'], 'empty.txt')], {}, ctx)).rejects.toThrow('Empty input.');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
});
