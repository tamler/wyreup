import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  TEXT_TO_SPEECH_PRO_MAX_CHARS,
  TEXT_TO_SPEECH_PRO_VOICES,
  textToSpeechPro,
} from '../../../src/tools/text-to-speech-pro/index.js';
import { fixGrammarPro } from '../../../src/tools/fix-grammar-pro/index.js';
import { deepAnalysisPro } from '../../../src/tools/deep-analysis-pro/index.js';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import { PRO_TEXT_LIMITS } from '../../../src/lib/pro-limits.js';
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

  it('fix-grammar-pro rejects CJK text over its token cap without a request', async () => {
    const fetchMock = stubFetch({});
    await expect(fixGrammarPro.run([textFile('漢'.repeat(4_001))], {}, makeCtx())).rejects.toThrow(
      '4,000 of Chinese, Japanese or Korean',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fix-grammar-pro still takes 12,000 characters of English', async () => {
    const fetchMock = stubFetch({ corrected: 'ok' });
    await fixGrammarPro.run([textFile('a'.repeat(12_000))], {}, makeCtx());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deep-analysis-pro rejects an over-long question without a request', async () => {
    const fetchMock = stubFetch({});
    await expect(
      deepAnalysisPro.run([textFile('doc')], { question: 'q'.repeat(2_200) }, makeCtx()),
    ).rejects.toThrow('The question is too long');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('client caps, voices, copy and prices mirror the server', () => {
  it('matches the server TTS caps, voice lists and PRICING', async () => {
    const tts = (await import(FUNCTIONS('providers/tts-models.js'))) as {
      TTS_MAX_CHARS: unknown;
      TTS_VOICES: unknown;
    };
    const { PRICING } = (await import(FUNCTIONS('pricing.js'))) as {
      PRICING: Record<string, number>;
    };
    expect(TEXT_TO_SPEECH_PRO_MAX_CHARS).toEqual(tts.TTS_MAX_CHARS);
    expect(TEXT_TO_SPEECH_PRO_VOICES).toEqual(tts.TTS_VOICES);
    const registry = createDefaultRegistry();
    for (const toolId of new Set([...Object.keys(PRO_TEXT_LIMITS), 'text-to-speech-pro'])) {
      const tool = registry.toolsById.get(toolId);
      expect(tool, toolId).toBeDefined();
      expect(tool!.creditCost, toolId).toBe(PRICING[toolId]);
      expect(tool!.description, toolId).toContain(`Uses ${PRICING[toolId]} credit`);
    }
  });

  it.each([
    'deep-analysis-pro',
    'fix-grammar-pro',
    'json-extract-pro',
    'chat-long-pdf-pro',
    'pdf-q-and-a',
    'text-sentiment-pro',
    'text-ner-pro',
    'content-safety-pro',
    'translate-many-pro',
    'translate-document-pro',
  ])('%s description states its main text cap', (toolId) => {
    const tool = createDefaultRegistry().toolsById.get(toolId)!;
    const max = PRO_TEXT_LIMITS[toolId]!.text!;
    expect(tool.description).toContain(
      `${max.toLocaleString('en-US')} of Chinese, Japanese or Korean`,
    );
    expect(tool.description).toContain(
      `${Math.min(max * 3, 100_000).toLocaleString('en-US')} characters of English`,
    );
  });
});
