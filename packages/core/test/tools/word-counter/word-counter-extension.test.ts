import { describe, it, expect, vi } from 'vitest';
import { countWordText, wordCounter } from '../../../src/tools/word-counter/index.js';
import type { ToolRunContext } from '../../../src/types.js';

describe('Unicode and speaking extensions', () => {
  it('keeps Unicode metrics distinct and uses UTF-16 for the chosen post limit', () => {
    expect(countWordText('a👩‍💻', { postLimit: 5 })).toMatchObject({ characters: 6, codePoints: 4, graphemes: 2, utf8Bytes: 12, remaining: 0, over: 1 });
    expect(countWordText('A B.')).toMatchObject({ words: 2, characters: 4, sentences: 1, paragraphs: 1, lines: 1, readingTimeMinutes: 0, speakingSeconds: 0.8 });
  });
  it('preserves the fixed reading rate while speaking rate changes', () => {
    const text = Array(400).fill('word').join(' ');
    expect(countWordText(text, { speakingWPM: 100 })).toMatchObject({ readingTimeMinutes: 2, speakingSeconds: 240 });
    expect(countWordText(text, { speakingWPM: 200 })).toMatchObject({ readingTimeMinutes: 2, speakingSeconds: 120 });
    expect(countWordText('', { postLimit: 10 })).toMatchObject({ words: 0, codePoints: 0, graphemes: 0, utf8Bytes: 0, speakingSeconds: 0, remaining: 10 });
  });
  it('validates strings before byte encoding and parameters before counting', () => {
    expect(() => countWordText('\ud800')).toThrow('unpaired');
    expect(() => countWordText('a', { speakingWPM: 0 })).toThrow();
    expect(() => countWordText('a', { postLimit: 1.5 })).toThrow();
    expect(() => countWordText('a', { unknown: true } as never)).toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => countWordText('a', {}, 'text/plain', controller.signal)).toThrow('cancelled');
  });
  it('retains the legacy fallback and explicitly marks unavailable grapheme segmentation', () => {
    vi.stubGlobal('Intl', {});
    try { expect(countWordText('a👩‍💻')).toMatchObject({ characters: 6, codePoints: 4, graphemes: null, graphemeCounting: 'unavailable' }); }
    finally { vi.unstubAllGlobals(); }
  });
  it('rejects invalid UTF-8 files and preserves stripped-HTML metrics', async () => {
    const ctx: ToolRunContext = { signal: new AbortController().signal, onProgress: () => {}, cache: new Map(), executionId: 'unicode-extension' };
    await expect(wordCounter.run([new File([new Uint8Array([0xc3])], 'bad.txt')], {}, ctx)).rejects.toThrow();
    expect(countWordText('<b>é</b>', {}, 'text/html')).toMatchObject({ words: 1, utf8Bytes: 4, codePoints: 3, graphemes: 3 });
  });
});
