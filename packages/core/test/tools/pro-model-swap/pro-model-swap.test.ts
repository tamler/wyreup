import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  TEXT_TO_SPEECH_PRO_MAX_CHARS,
  TEXT_TO_SPEECH_PRO_VOICES,
  textToSpeechPro,
} from '../../../src/tools/text-to-speech-pro/index.js';
import {
  FIX_GRAMMAR_PRO_MAX_CHARS,
  fixGrammarPro,
} from '../../../src/tools/fix-grammar-pro/index.js';
import {
  DEEP_ANALYSIS_PRO_MAX_QUESTION_CHARS,
  deepAnalysisPro,
} from '../../../src/tools/deep-analysis-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const FUNCTIONS = (path: string) =>
  fileURLToPath(new URL(`../../../../../functions/_lib/${path}`, import.meta.url));

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'pro-model-swap-test',
    apiKey: 'test-key',
    proOrigin: 'https://wyreup.test',
  };
}

const textFile = (text: string) => new File([text], 'in.txt', { type: 'text/plain' });

function stubFetch(result: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pro tools moved off retiring models', () => {
  it('text-to-speech-pro offers only English and Spanish', () => {
    const language = textToSpeechPro.paramSchema?.language;
    expect(language?.type).toBe('enum');
    expect(language && 'options' in language ? language.options.map((o) => o.value) : []).toEqual([
      'EN',
      'ES',
    ]);
  });

  it('text-to-speech-pro rejects text over the per-language cap without a request', async () => {
    const fetchMock = stubFetch({});
    await expect(
      textToSpeechPro.run([textFile('a'.repeat(1_001))], { language: 'EN' }, makeCtx()),
    ).rejects.toThrow('limited to 1,000 characters');
    await expect(
      textToSpeechPro.run([textFile('a'.repeat(501))], { language: 'ES' }, makeCtx()),
    ).rejects.toThrow('limited to 500 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('text-to-speech-pro rejects a voice from the other language and retired languages', async () => {
    const fetchMock = stubFetch({});
    await expect(
      textToSpeechPro.run([textFile('hola')], { language: 'ES', voice: 'asteria' }, makeCtx()),
    ).rejects.toThrow("Voice 'asteria' is not available for Spanish");
    await expect(
      textToSpeechPro.run([textFile('bonjour')], { language: 'FR' as unknown as 'EN' }, makeCtx()),
    ).rejects.toThrow('English (EN) and Spanish (ES) only');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('text-to-speech-pro sends language and voice and decodes the MP3', async () => {
    const fetchMock = stubFetch({ contentType: 'audio/mpeg', base64: btoa('ID3abc') });
    const out = await textToSpeechPro.run(
      [textFile('Hola mundo')],
      { language: 'ES', voice: 'celeste' },
      makeCtx(),
    );
    if (Array.isArray(out)) throw new Error('expected one Blob');
    const blob = out;
    expect(blob.type).toBe('audio/mpeg');
    expect(await new Response(blob).text()).toBe('ID3abc');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toMatchObject({
      toolId: 'text-to-speech-pro',
      input: { text: 'Hola mundo', language: 'ES', voice: 'celeste' },
    });
  });

  it('fix-grammar-pro rejects text over 12,000 characters without a request', async () => {
    const fetchMock = stubFetch({});
    await expect(
      fixGrammarPro.run([textFile('a'.repeat(FIX_GRAMMAR_PRO_MAX_CHARS + 1))], {}, makeCtx()),
    ).rejects.toThrow('up to 12,000 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deep-analysis-pro rejects an over-long question without a request', async () => {
    const fetchMock = stubFetch({});
    await expect(
      deepAnalysisPro.run(
        [textFile('doc')],
        { question: 'q'.repeat(DEEP_ANALYSIS_PRO_MAX_QUESTION_CHARS + 1) },
        makeCtx(),
      ),
    ).rejects.toThrow('under 2,000 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('client caps, voices and prices mirror the server', () => {
  it('matches the server caps, voice lists and PRICING', async () => {
    const tts = (await import(FUNCTIONS('providers/tts-models.js'))) as {
      TTS_MAX_CHARS: unknown;
      TTS_VOICES: unknown;
    };
    const runners = (await import(FUNCTIONS('runners.js'))) as {
      FIX_GRAMMAR: { maxChars: number };
      DEEP_ANALYSIS: { maxQuestionChars: number };
    };
    const { PRICING } = (await import(FUNCTIONS('pricing.js'))) as {
      PRICING: Record<string, number>;
    };
    expect(TEXT_TO_SPEECH_PRO_MAX_CHARS).toEqual(tts.TTS_MAX_CHARS);
    expect(TEXT_TO_SPEECH_PRO_VOICES).toEqual(tts.TTS_VOICES);
    expect(FIX_GRAMMAR_PRO_MAX_CHARS).toBe(runners.FIX_GRAMMAR.maxChars);
    expect(DEEP_ANALYSIS_PRO_MAX_QUESTION_CHARS).toBe(runners.DEEP_ANALYSIS.maxQuestionChars);
    for (const tool of [textToSpeechPro, deepAnalysisPro, fixGrammarPro]) {
      expect(tool.creditCost, tool.id).toBe(PRICING[tool.id]);
      expect(tool.description, tool.id).toContain(`Uses ${PRICING[tool.id]} credit`);
    }
  });
});
