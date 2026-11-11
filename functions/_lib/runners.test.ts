import { describe, it, expect, vi } from 'vitest';
import { __readImageBytes, readImageRef, runPro, prepareProRun } from './runners';
import type { Env } from './env';
import { PRICING } from './pricing';

/** A silent 8 kHz 16-bit mono PCM WAV of `seconds`, base64. */
function wavBase64(seconds: number): string {
  const dataLen = Math.round(seconds * 16_000);
  const bytes = new Uint8Array(44 + dataLen);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataLen, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
const TINY_WAV = wavBase64(0.1);

/** 8 kHz 8-bit mono PCM (8,000 bytes/s): long durations that still fit 25 MB. */
function wav8BitBase64(seconds: number): string {
  const dataLen = Math.round(seconds * 8_000);
  const bytes = new Uint8Array(44 + dataLen).fill(0x80);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 8_000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  tag(36, 'data');
  view.setUint32(40, dataLen, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// A 1x1 PNG, base64.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('preparing Pro dispatch', () => {
  it.each(['', ' \t\n '])('uses the default JSON extraction hint for a blank client schema %j', async schema => {
    const env = aiEnv({ response: '{"sender":"a","total":1}' });
    const run = vi.spyOn(env.AI, 'run');
    // Mirrors defaultJsonExtractProParams and the payload sent by its public runner.
    await expect(runPro('json-extract-pro', { text: 'Receipt A', schema, fileName: 'receipt.txt' }, env))
      .resolves.toEqual({ data: { sender: 'a', total: 1 } });
    expect(run).toHaveBeenCalledTimes(1);
    const call = run.mock.calls[0];
    expect(call[0]).toBe('@cf/meta/llama-4-scout-17b-16e-instruct');
    const payload = call[1] as { messages: { role: unknown; content: unknown }[] };
    expect(payload.messages.some(message =>
      message.role === 'user' && typeof message.content === 'string' &&
      message.content.includes('Schema hint: Pick the most descriptive fields you can find. Use snake_case keys.'),
    )).toBe(true);
  });
  it.each([
    ['text-translate-pro', { text: 'hello', target: '' }],
    ['translate-many-pro', { text: 'hello', source: ' ', target: 'es' }],
  ])('prepares %s with a blank optional language without provider work', (toolId, input) => {
    const env = aiEnv({});
    const run = vi.spyOn(env.AI, 'run');
    expect(typeof prepareProRun(toolId, input, env)).toBe('function');
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    ['json-extract-pro', { text: 'receipt', schema: null }],
    ['json-extract-pro', { text: 'receipt', schema: 123 }],
    ['text-translate-pro', { text: 'hello', target: [] }],
    ['text-translate-pro', { text: 'hello', target: ' '.repeat(101) }],
    ['translate-many-pro', { text: 'hello', source: 'en', target: '' }],
  ])('still rejects malformed or required values for %s before provider work', (toolId, input) => {
    const env = aiEnv({});
    const run = vi.spyOn(env.AI, 'run');
    expect(() => prepareProRun(toolId, input, env)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('prepares every priced runner without provider work', () => {
    const env = aiEnv({ response: 'ok' });
    for (const toolId of Object.keys(PRICING)) {
      const dispatch = prepareProRun(
        toolId,
        {
          text: 'text',
          question: 'question',
          prompt: 'prompt',
          description: 'description',
          target: toolId === 'translate-indic-pro' ? 'hin_Deva' : 'en',
          image: `data:image/png;base64,${TINY_PNG}`,
          imageBase64: TINY_PNG,
          audioBase64: TINY_WAV,
        },
        env,
      );
      expect(typeof dispatch, toolId).toBe('function');
    }
    expect(vi.spyOn(env.AI, 'run')).not.toHaveBeenCalled();
  });
  it('rejects malformed input before any provider work', () => {
    const env = aiEnv({ response: 'ok' });
    expect(() => prepareProRun('text-summarize-pro', {}, env)).toThrow();
    expect(vi.spyOn(env.AI, 'run')).not.toHaveBeenCalled();
  });
  it('captures validated input without invoking a provider until dispatch', async () => {
    const env = aiEnv({ response: 'summary' });
    const input = { text: 'original' };
    const dispatch = prepareProRun('text-summarize-pro', input, env);
    input.text = '';
    expect(vi.spyOn(env.AI, 'run')).not.toHaveBeenCalled();
    await expect(dispatch()).resolves.toEqual({ summary: 'summary' });
  });
  it('rejects normalized mapped private addresses', () => {
    expect(() => readImageRef({ image: 'https://[::ffff:127.0.0.1]/private' })).toThrow();
  });
  it.each([
    ['text-to-speech-pro', { text: 'hello', language: 'XX' }],
    ['image-generate-pro', { prompt: 'image', steps: 1.5 }],
    ['text-translate-pro', { text: 'hello', target: 'x'.repeat(101) }],
    ['transcribe-pro', { audioBase64: '!!!' }],
    ['ocr-hq', { imageBase64: 'QUJD' }],
  ])('rejects malformed runner-specific values for %s', (toolId, input) => {
    expect(() => prepareProRun(toolId, input as Record<string, unknown>, aiEnv({}))).toThrow();
  });
});

function aiEnv(result: unknown) {
  return { AI: { run: vi.fn().mockResolvedValue(result) } } as unknown as Env;
}

describe('ocr-hq runner', () => {
  it('returns extracted text', async () => {
    const env = aiEnv({ response: 'INVOICE 2024' });
    const out = (await runPro('ocr-hq', { imageBase64: TINY_PNG }, env)) as { text: string };
    expect(out.text).toBe('INVOICE 2024');
  });

  it('rejects a missing image', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('ocr-hq', {}, env)).rejects.toThrow('imageBase64 required');
  });
});

describe('image-describe runner', () => {
  it('returns a description', async () => {
    const env = aiEnv({ response: 'A red bicycle leaning on a wall.' });
    const out = (await runPro('image-describe', { imageBase64: TINY_PNG }, env)) as {
      description: string;
    };
    expect(out.description).toBe('A red bicycle leaning on a wall.');
  });
});

describe('analyze-chart runner', () => {
  it('returns an analysis', async () => {
    const env = aiEnv({ response: 'Bar chart: sales rose Q1 to Q4.' });
    const out = (await runPro('analyze-chart', { imageBase64: TINY_PNG }, env)) as {
      analysis: string;
    };
    expect(out.analysis).toBe('Bar chart: sales rose Q1 to Q4.');
  });
});

describe('image-q-and-a runner', () => {
  it('returns an answer to the question', async () => {
    const env = aiEnv({ response: 'Three people are visible.' });
    const out = (await runPro(
      'image-q-and-a',
      { imageBase64: TINY_PNG, question: 'How many people?' },
      env,
    )) as { answer: string };
    expect(out.answer).toBe('Three people are visible.');
  });

  it('rejects a missing question', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('image-q-and-a', { imageBase64: TINY_PNG }, env)).rejects.toThrow(
      "'question'",
    );
  });
});

describe('read-handwriting runner', () => {
  it('returns transcribed handwriting', async () => {
    const env = aiEnv({ response: 'Meeting at 3pm' });
    const out = (await runPro('read-handwriting', { imageBase64: TINY_PNG }, env)) as {
      text: string;
    };
    expect(out.text).toBe('Meeting at 3pm');
  });
});

describe('detect-objects (disabled 2026-11-11, no published model price)', () => {
  it('is no longer a hosted runner', () => {
    expect(() => prepareProRun('detect-objects', { imageBase64: TINY_PNG }, aiEnv({}))).toThrow(
      'No hosted runner',
    );
    expect(PRICING['detect-objects']).toBeUndefined();
  });
});

describe('translate-image runner', () => {
  it('OCRs then translates, returning both', async () => {
    // First AI.run = vision OCR, second = text translation.
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: 'Hola mundo' })
      .mockResolvedValueOnce({ response: 'Hello world' });
    const env = { AI: { run } } as unknown as Env;
    const out = (await runPro(
      'translate-image',
      { imageBase64: TINY_PNG, target: 'English' },
      env,
    )) as { sourceText: string; translation: string; target: string };
    expect(out.sourceText).toBe('Hola mundo');
    expect(out.translation).toBe('Hello world');
    expect(out.target).toBe('English');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('transcribe-and-translate runner', () => {
  it('transcribes then translates', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bonjour le monde' }) // whisper
      .mockResolvedValueOnce({ response: 'Hello world' }); // translate
    const env = { AI: { run } } as unknown as Env;
    // A real (silent) WAV: the runner measures duration before dispatch.
    const out = (await runPro(
      'transcribe-and-translate',
      { audioBase64: TINY_WAV, target: 'English' },
      env,
    )) as { transcript: string; translation: string; target: string };
    expect(out.transcript).toBe('Bonjour le monde');
    expect(out.translation).toBe('Hello world');
    expect(out.target).toBe('English');
  });

  it('rejects missing audio', async () => {
    const env = aiEnv({ text: 'x' });
    await expect(runPro('transcribe-and-translate', { target: 'English' }, env)).rejects.toThrow(
      'audioBase64 required',
    );
  });
});

describe('__readImageBytes', () => {
  it('decodes a valid base64 image', () => {
    const bytes = __readImageBytes({ imageBase64: TINY_PNG });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('throws when imageBase64 is missing', () => {
    expect(() => __readImageBytes({})).toThrow('imageBase64 required');
  });

  it('throws when the image exceeds the size cap', () => {
    const huge = 'A'.repeat(20 * 1024 * 1024);
    expect(() => __readImageBytes({ imageBase64: huge })).toThrow('exceeds');
  });
});

describe('regex-from-text-pro runner', () => {
  it('parses the model JSON into a regex result', async () => {
    const env = aiEnv({
      response: '{"pattern":"\\\\d+","flags":"g","explanation":"one or more digits"}',
    });
    const out = (await runPro('regex-from-text-pro', { description: 'match numbers' }, env)) as {
      pattern: string;
      flags: string;
      fullRegex: string;
    };
    expect(out.pattern).toBe('\\d+');
    expect(out.flags).toBe('g');
    expect(out.fullRegex).toBe('/\\d+/g');
  });

  it('rejects a missing description', async () => {
    const env = aiEnv({ response: '{}' });
    await expect(runPro('regex-from-text-pro', {}, env)).rejects.toThrow("'description'");
  });

  it('throws on unparseable model output', async () => {
    const env = aiEnv({ response: 'not json at all' });
    await expect(runPro('regex-from-text-pro', { description: 'x' }, env)).rejects.toThrow(
      'unparseable',
    );
  });
});

describe('cron-from-text-pro runner', () => {
  it('parses the model JSON into a cron result', async () => {
    const env = aiEnv({
      response: '{"cron":"0 9 * * 1","explanation":"every Monday at 9am"}',
    });
    const out = (await runPro(
      'cron-from-text-pro',
      { description: 'every monday at 9am' },
      env,
    )) as { cron: string; explanation: string };
    expect(out.cron).toBe('0 9 * * 1');
    expect(out.explanation).toBe('every Monday at 9am');
  });
});

describe('pdf-summarize runner', () => {
  it('returns a summary of the document text', async () => {
    const env = aiEnv({ response: 'The document covers quarterly results.' });
    const out = (await runPro('pdf-summarize', { text: 'Long document text here.' }, env)) as {
      summary: string;
    };
    expect(out.summary).toBe('The document covers quarterly results.');
  });

  it('rejects missing document text', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('pdf-summarize', {}, env)).rejects.toThrow("'text'");
  });
});

describe('pdf-q-and-a runner', () => {
  it('returns an answer to the question', async () => {
    const env = aiEnv({ response: 'The total is $420.' });
    const out = (await runPro(
      'pdf-q-and-a',
      { text: 'Invoice. Total: $420.', question: 'What is the total?' },
      env,
    )) as { answer: string };
    expect(out.answer).toBe('The total is $420.');
  });

  it('rejects a missing question', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('pdf-q-and-a', { text: 'some document' }, env)).rejects.toThrow(
      "'question'",
    );
  });
});

describe('readImageRef SSRF validation', () => {
  it('accepts a data:image/ URL', () => {
    const data = `data:image/png;base64,${TINY_PNG}`;
    expect(readImageRef({ image: data })).toBe(data);
  });

  it('rejects an http:// URL', () => {
    expect(() => readImageRef({ image: 'http://example.com/cat.png' })).toThrow('data URL');
  });

  it('rejects the cloud metadata IP', () => {
    expect(() => readImageRef({ image: 'https://169.254.169.254/latest/meta-data/' })).toThrow(
      'data URL',
    );
  });

  it('rejects https://localhost', () => {
    expect(() => readImageRef({ image: 'https://localhost/x' })).toThrow('data URL');
  });

  it('rejects all externally fetched URLs including DNS and redirect paths', () => {
    for (const h of [
      'example.com',
      'localhost',
      'host.local',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.5',
      '172.31.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fc00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(() => readImageRef({ image: `https://${h}/image.png` })).toThrow('data URL');
    }
  });

  it.each([
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,YWJj',
    'data:image/jpeg;base64,!!!',
  ])('rejects invalid image upload %s', (image) => {
    expect(() => readImageRef({ image })).toThrow();
  });
});

// Cloudflare returns 410 for melotts, deepseek-r1-distill-qwen-32b and
// llama-3.2-3b-instruct from 2026-11-20.
describe('runners moved off retiring models', () => {
  const RETIRED = [
    '@cf/myshell-ai/melotts',
    '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    '@cf/meta/llama-3.2-3b-instruct',
  ];
  const completion = (content: string | null, reasoning_content?: string) => ({
    choices: [{ message: { role: 'assistant', content, refusal: null, reasoning_content } }],
  });
  const aiMock = (result: unknown) => {
    const run = vi.fn((_model: string, _input: Record<string, unknown>) => Promise.resolve(result));
    return { env: { AI: { run } } as unknown as Env, run };
  };
  const mp3Stream = (bytes: number[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });

  it('text-to-speech-pro uses Aura 1 for English and returns the streamed MP3 as base64', async () => {
    const { env, run } = aiMock(mp3Stream([0x49, 0x44, 0x33]));
    const out = await runPro('text-to-speech-pro', { text: 'hello', language: 'EN' }, env);
    expect(out).toEqual({ contentType: 'audio/mpeg', base64: btoa('ID3') });
    expect(run).toHaveBeenCalledWith('@cf/deepgram/aura-1', {
      text: 'hello',
      speaker: 'asteria',
      encoding: 'mp3',
    });
  });

  it('text-to-speech-pro uses Aura 2 Spanish with the chosen voice', async () => {
    const { env, run } = aiMock(mp3Stream([1, 2]));
    await runPro('text-to-speech-pro', { text: 'hola', language: 'ES', voice: 'celeste' }, env);
    expect(run.mock.calls[0]?.[0]).toBe('@cf/deepgram/aura-2-es');
    expect(run.mock.calls[0]?.[1]).toMatchObject({ speaker: 'celeste' });
  });

  it.each([
    [{ text: 'a'.repeat(1_001), language: 'EN' }],
    [{ text: 'a'.repeat(501), language: 'ES' }],
    [{ text: 'bonjour', language: 'FR' }],
    [{ text: 'hola', language: 'ES', voice: 'asteria' }],
  ])('text-to-speech-pro rejects %j before provider work', (input) => {
    const { env, run } = aiMock({});
    expect(() => prepareProRun('text-to-speech-pro', input, env)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('text-to-speech-pro accepts exactly the cap', () => {
    expect(typeof prepareProRun('text-to-speech-pro', { text: 'a'.repeat(1_000) }, aiEnv({}))).toBe(
      'function',
    );
  });

  it('text-to-speech-pro fails (and so refunds) on an empty audio stream', async () => {
    await expect(
      runPro('text-to-speech-pro', { text: 'hello' }, aiEnv(mp3Stream([]))),
    ).rejects.toThrow('no audio');
  });

  it('deep-analysis-pro calls DeepSeek V4.1 Flash with thinking on and a bounded budget', async () => {
    const { env, run } = aiMock(completion('The answer.', 'Step one.'));
    const out = await runPro('deep-analysis-pro', { text: 'doc', question: 'q?' }, env);
    expect(out).toEqual({ answer: 'The answer.', reasoning: 'Step one.' });
    const [model, payload] = run.mock.calls[0];
    expect(model).toBe('@cf/deepseek-ai/deepseek-v4.1-flash-1017');
    expect(payload).toMatchObject({
      max_tokens: 6_144,
      max_completion_tokens: 6_144,
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it('deep-analysis-pro splits an inline <think> block from the answer', async () => {
    const { env } = aiMock(completion('<think>Because.</think>\nYes.'));
    await expect(
      runPro('deep-analysis-pro', { text: 'doc', question: 'q?' }, env),
    ).resolves.toEqual({ answer: 'Yes.', reasoning: 'Because.' });
  });

  it('deep-analysis-pro falls back to Gemma 4 once when the primary errors', async () => {
    const run = vi
      .fn<(model: string, input: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('5016: requires Workers Paid'))
      .mockResolvedValueOnce(completion('Fallback answer.', 'Fallback reasoning.'));
    const env = { AI: { run } } as unknown as Env;
    await expect(
      runPro('deep-analysis-pro', { text: 'doc', question: 'q?' }, env),
    ).resolves.toEqual({ answer: 'Fallback answer.', reasoning: 'Fallback reasoning.' });
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      '@cf/google/gemma-4-26b-a4b-it',
    ]);
  });

  it('deep-analysis-pro does not stack a fallback on a timed-out primary', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(() => new Promise<never>(() => {}));
      const env = { AI: { run } } as unknown as Env;
      const pending = runPro('deep-analysis-pro', { text: 'doc', question: 'q?' }, env);
      const assertion = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(90_001);
      await assertion;
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deep-analysis-pro rejects a question over its 700-token cap before provider work', () => {
    const { env, run } = aiMock({});
    expect(() =>
      prepareProRun('deep-analysis-pro', { text: 'doc', question: 'q'.repeat(2_200) }, env),
    ).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('fix-grammar-pro calls Gemma 4 with thinking off and returns the corrected text', async () => {
    const { env, run } = aiMock(completion(' Fixed text. '));
    await expect(runPro('fix-grammar-pro', { text: 'fixd txt' }, env)).resolves.toEqual({
      corrected: 'Fixed text.',
    });
    const [model, payload] = run.mock.calls[0];
    expect(model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(payload).toMatchObject({
      max_completion_tokens: 6_144,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('fix-grammar-pro rejects English text over 12,000 chars (4,000 tokens) before provider work', () => {
    const { env, run } = aiMock({});
    expect(() => prepareProRun('fix-grammar-pro', { text: 'a'.repeat(12_001) }, env)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('fix-grammar-pro fails (and so refunds) when the model returns no text', async () => {
    await expect(runPro('fix-grammar-pro', { text: 'x' }, aiEnv(completion(null)))).rejects.toThrow();
  });

  it.each([
    ['text-to-speech-pro', { text: 'hello' }, mp3Stream([1])],
    ['deep-analysis-pro', { text: 'doc', question: 'q?' }, completion('a')],
    ['fix-grammar-pro', { text: 'x' }, completion('x')],
  ])('%s never calls a retired model', async (toolId, input, result) => {
    const { env, run } = aiMock(result);
    await runPro(toolId, input, env);
    for (const [model] of run.mock.calls) {
      expect(RETIRED).not.toContain(model);
    }
  });
});

describe('previously unbounded tools are bounded before any spend', () => {
  const gemmaReply = (content: string) => ({
    choices: [{ message: { role: 'assistant', content, refusal: null } }],
  });

  it.each(['transcribe-pro', 'transcribe-and-translate'])(
    '%s refuses audio over 45 minutes before provider work',
    (toolId) => {
      const run = vi.fn();
      const env = { AI: { run } } as unknown as Env;
      expect(() =>
        prepareProRun(toolId, { audioBase64: wav8BitBase64(46 * 60), target: 'English' }, env),
      ).toThrow('45 minutes');
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(['transcribe-pro', 'transcribe-and-translate'])(
    '%s accepts 45 minutes exactly',
    (toolId) => {
      expect(
        typeof prepareProRun(
          toolId,
          { audioBase64: wav8BitBase64(45 * 60), target: 'English' },
          aiEnv({}),
        ),
      ).toBe('function');
    },
  );

  it.each(['transcribe-pro', 'transcribe-and-translate'])(
    '%s refuses formats whose length cannot be verified',
    (toolId) => {
      // 'ftypM4A' box: an M4A container.
      const m4a = btoa('\u0000\u0000\u0000\u0018ftypM4A \u0000\u0000\u0000\u0000');
      expect(() =>
        prepareProRun(toolId, { audioBase64: m4a, target: 'English' }, aiEnv({})),
      ).toThrow('WAV or MP3');
    },
  );

  it('transcribe-and-translate trims a huge transcript to its token cap before translating', async () => {
    const run = vi
      .fn<(model: string, input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValueOnce({ text: '漢'.repeat(25_000) })
      .mockResolvedValueOnce({ response: 'translated' });
    const env = { AI: { run } } as unknown as Env;
    const out = (await runPro(
      'transcribe-and-translate',
      { audioBase64: TINY_WAV, target: 'English' },
      env,
    )) as { translationTruncated?: boolean };
    expect(out.translationTruncated).toBe(true);
    const messages = run.mock.calls[1][1].messages as { role: string; content: string }[];
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user.length).toBeLessThanOrEqual(20_000);
  });

  it('translate-many-pro uses Gemma 4 with output capped from the input estimate', async () => {
    const run = vi.fn((_m: string, _i: Record<string, unknown>) =>
      Promise.resolve(gemmaReply('Bonjour')),
    );
    const env = { AI: { run } } as unknown as Env;
    await expect(
      runPro('translate-many-pro', { text: 'hello there', source: 'en', target: 'fr' }, env),
    ).resolves.toMatchObject({ translation: 'Bonjour', target: 'fr' });
    const [model, payload] = run.mock.calls[0];
    expect(model).toBe('@cf/google/gemma-4-26b-a4b-it');
    // 'hello there' = 11 ASCII chars = 4 estimated tokens -> ceil(4 * 1.5) + 128.
    expect(payload).toMatchObject({
      max_completion_tokens: 134,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(JSON.stringify(payload.messages)).toContain('French (fr)');
  });

  it('translate-indic-pro sends English to the chosen Indic script through Gemma 4', async () => {
    const run = vi.fn((_m: string, _i: Record<string, unknown>) =>
      Promise.resolve(gemmaReply('नमस्ते')),
    );
    const env = { AI: { run } } as unknown as Env;
    await expect(
      runPro('translate-indic-pro', { text: 'hello', target: 'hin_Deva' }, env),
    ).resolves.toMatchObject({ translation: 'नमस्ते', target: 'hin_Deva' });
    expect(run.mock.calls[0][0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(JSON.stringify(run.mock.calls[0][1].messages)).toContain('Hindi (Devanagari script)');
  });

  it('translate-document-pro translates chunks in parallel and keeps their order', async () => {
    const run = vi.fn((_m: string, input: Record<string, unknown>) => {
      const messages = input.messages as { role: string; content: string }[];
      const text = messages.find((m) => m.role === 'user')!.content;
      return Promise.resolve(gemmaReply(`T(${text.trim().slice(0, 1)})`));
    });
    const env = { AI: { run } } as unknown as Env;
    const doc = ['a', 'b', 'c'].map((c) => c.repeat(7_000)).join('\n\n');
    const out = (await runPro(
      'translate-document-pro',
      { text: doc, source: 'en', target: 'fr' },
      env,
    )) as { text: string; chunks: number };
    expect(out.chunks).toBe(3);
    expect(out.text).toBe('T(a)\n\nT(b)\n\nT(c)');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('translate-document-pro refuses more than 100,000 characters', () => {
    expect(() =>
      prepareProRun(
        'translate-document-pro',
        { text: 'a'.repeat(100_001), target: 'fr' },
        aiEnv({}),
      ),
    ).toThrow();
  });
});
