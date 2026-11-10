import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import { transcribePro } from '../../../src/tools/transcribe-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

const VTT = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:01.500',
  'Hello there',
  '',
  '00:00:01.500 --> 00:00:03.250',
  'second line',
  '',
].join('\n');

function ctx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'transcribe-pro-test',
    apiKey: 'wk_test',
    proOrigin: 'https://wyreup.test',
  };
}

function stubServer(result: unknown) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const audio = () => new File([new Uint8Array([1, 2, 3])], 'talk.mp3', { type: 'audio/mpeg' });

afterEach(() => vi.unstubAllGlobals());

describe('transcribe-pro subtitles', () => {
  it('declares an output format with plain text as the default', () => {
    const tool = createDefaultRegistry().toolsById.get('transcribe-pro');
    expect(tool?.defaults).toMatchObject({ format: 'text' });
    const field = (tool?.paramSchema as Record<string, { type: string; options?: { value: string }[] }>)
      .format;
    expect(field?.type).toBe('enum');
    expect(field?.options?.map((o) => o.value)).toEqual(['text', 'srt', 'vtt']);
    expect(tool?.creditCost).toBe(3);
  });

  it('returns plain text by default and sends format text', async () => {
    const fetchMock = stubServer({ text: 'Hello there second line', vtt: VTT });
    const out = (await transcribePro.run([audio()], { language: 'en' }, ctx())) as Blob;
    expect(out.type).toBe('text/plain');
    expect(await out.text()).toBe('Hello there second line');
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      input: { format: string };
    };
    expect(body.input.format).toBe('text');
  });

  it('returns the WebVTT captions for format vtt', async () => {
    stubServer({ text: 'x', vtt: VTT });
    const out = (await transcribePro.run([audio()], { language: 'en', format: 'vtt' }, ctx())) as Blob;
    expect(out.type).toBe('text/vtt');
    expect(await out.text()).toBe(VTT);
  });

  it('converts the captions to numbered SRT for format srt', async () => {
    stubServer({ text: 'x', vtt: VTT });
    const out = (await transcribePro.run([audio()], { language: 'en', format: 'srt' }, ctx())) as Blob;
    expect(out.type).toBe('application/x-subrip');
    const srt = await out.text();
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,500\nHello there');
    expect(srt).toContain('2\n00:00:01,500 --> 00:00:03,250\nsecond line');
  });

  it('fails clearly if subtitles were requested and none came back', async () => {
    stubServer({ text: 'x', vtt: null });
    await expect(
      transcribePro.run([audio()], { language: 'en', format: 'srt' }, ctx()),
    ).rejects.toThrow('no subtitle timings');
  });
});
