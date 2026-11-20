import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { prepareProRun, runPro } from '../runners';
import type { HistoricalProviderEnv as Env } from '../historical-env';
import { TTS_MAX_AUDIO_BYTES } from './tts-models';
import { INFERENCE_TIMEOUTS } from '../timeout';
import { correctGrammar, OutputTruncatedError } from './new-text-models';
import { GRAMMAR_EDIT_PROMPT } from './grammar-edits';
import grammarPreservationFixture from './fixtures/grammar-preservation-11.json';

// Contract fixtures reflect the documented input options and synchronous choices shape,
// not a captured runtime response. Checked 2026-11-13:
// https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/
// https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
// https://developers.cloudflare.com/workers-ai/models/aura-2-en/
// https://developers.cloudflare.com/workers-ai/models/aura-2-es/

function envWith(result: unknown) {
  const run = vi.fn().mockResolvedValue(result);
  return { env: { AI: { run } } as unknown as Env, run };
}

describe('replacement model contracts', () => {
  it('uses bounded DeepSeek completion and returns a separate answer', async () => {
    const { env, run } = envWith({ choices: [{ finish_reason: 'stop', message: { content: ' Answer ', reasoning_content: '\nEvidence\t' } }] });
    await expect(runPro('deep-analysis-pro', { text: 'Document', question: 'Why?' }, env)).resolves.toEqual({ answer: 'Answer', reasoning: 'Evidence' });
    expect(run).toHaveBeenCalledWith('@cf/deepseek-ai/deepseek-v4.1-flash-1017', expect.objectContaining({ max_completion_tokens: 6144, reasoning_effort: 'low', stream: false }));
  });

  it('fails rather than serving truncated grammar', async () => {
    const { env } = envWith({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] });
    await expect(runPro('fix-grammar-pro', { text: 'Example' }, env)).rejects.toThrow(OutputTruncatedError);
  });

  it('runs grammar on Gemma with a bounded completion', async () => {
    const text = 'This is correct';
    const { env, run } = envWith({ choices: [{ finish_reason: 'stop', message: { content: '[["This is ","correct","","correct."]]' } }] });
    await expect(runPro('fix-grammar-pro', { text }, env)).resolves.toEqual({ corrected: 'This is correct.' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('@cf/google/gemma-4-26b-a4b-it', {
      messages: [{ role: 'system', content: GRAMMAR_EDIT_PROMPT }, { role: 'user', content: text }],
      max_completion_tokens: 6144,
      chat_template_kwargs: { enable_thinking: false },
      stream: false,
    });
  });

  it('rejects captured near-cap prose from both attempts despite a normal stop', async () => {
    const input = Array(grammarPreservationFixture.inputSentenceCount)
      .fill(grammarPreservationFixture.sentence)
      .join(' ') + ' ';
    const failedOutput = Array(grammarPreservationFixture.failedOutputSentenceCount)
      .fill(grammarPreservationFixture.sentence)
      .join(' ');
    expect(new TextEncoder().encode(input)).toHaveLength(grammarPreservationFixture.source.inputBytes);
    expect(createHash('sha256').update(input).digest('hex')).toBe(grammarPreservationFixture.source.inputSha256);
    // The original and stronger-prompt response receipts contain identical prose.
    // Stronger-prompt full response SHA-256: 9d152f92930e64f93c3e3d1fce5bc6c7246ff30c03dd444c03d72e13cfb66309.
    expect(createHash('sha256').update(failedOutput).digest('hex')).toBe(grammarPreservationFixture.source.failedOutputSha256);
    expect(failedOutput.trim()).not.toBe(input.trim());
    const { env } = envWith({ choices: [{ finish_reason: grammarPreservationFixture.source.finishReason, message: { content: failedOutput } }] });
    await expect(runPro('fix-grammar-pro', { text: input }, env)).rejects.toThrow('Grammar model returned invalid edits');
  });

  it('sends the preservation directive with the unchanged near-cap request', async () => {
    const input = Array(grammarPreservationFixture.inputSentenceCount)
      .fill(grammarPreservationFixture.sentence)
      .join(' ') + ' ';
    const { env, run } = envWith({ choices: [{ finish_reason: 'stop', message: { content: ' \r\n[]\t ' } }] });
    await expect(runPro('fix-grammar-pro', { text: input }, env)).resolves.toEqual({ corrected: input });
    const [model, capturedRequest] = run.mock.calls[0] as unknown as [unknown, unknown];
    expect(model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(capturedRequest).toHaveProperty('max_completion_tokens', 6144);
    expect(capturedRequest).toHaveProperty('chat_template_kwargs', { enable_thinking: false });
    expect(capturedRequest).toHaveProperty('stream', false);
    expect(capturedRequest).toHaveProperty('messages');
    const request = capturedRequest as { messages?: unknown };
    if (!Array.isArray(request.messages)) throw new Error('Model request messages are not an array');
    const records = (request.messages as unknown[]).filter((message): message is Record<string, unknown> =>
      typeof message === 'object' && message !== null && !Array.isArray(message));
    const systemMessage = records.find(message => message.role === 'system');
    const userMessage = records.find(message => message.role === 'user');
    expect(systemMessage).toBeDefined();
    expect(userMessage).toBeDefined();
    if (!systemMessage || typeof systemMessage.content !== 'string') throw new Error('System preservation message is missing');
    if (!userMessage || userMessage.content !== input) throw new Error('Original user input changed');
    expect(systemMessage.content).toContain('Preserve every sentence');
    expect(userMessage.content).toBe(input);
  });

  it.each([
    ['The reports was ready.', ['The ', 'reports was', ' ready.', 'reports were'], 'The reports were ready.'],
    ['They went store.', ['They ', 'went store', '.', 'went to the store'], 'They went to the store.'],
    ['The the report is ready.', ['', 'The the', ' report', 'The'], 'The report is ready.'],
    ['I found a note book.', ['a ', 'note book', '.', 'notebook'], 'I found a notebook.'],
  ])('applies a local grammar edit to %j', async (text, edit, corrected) => {
    const { env } = envWith({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify([edit]) } }] });
    await expect(runPro('fix-grammar-pro', { text }, env)).resolves.toEqual({ corrected });
  });

  it('preserves the original input at the 4,000-byte limit', async () => {
    const text = '\uFEFF é' + 'é'.repeat(1996) + '\r\n';
    expect(new TextEncoder().encode(text)).toHaveLength(4000);
    const { env } = envWith({ choices: [{ finish_reason: 'stop', message: { content: '[]' } }] });
    await expect(runPro('fix-grammar-pro', { text }, env)).resolves.toEqual({ corrected: text });
  });

  it('rejects an ill-formed source before sending it to Gemma', async () => {
    const { env, run } = envWith({});
    await expect(correctGrammar(env, 'invalid \uD800 source')).rejects.toThrow('Grammar input must be well-formed Unicode.');
    expect(run).not.toHaveBeenCalled();
  });

  it('retains the text deadline for a stalled grammar call', async () => {
    vi.useFakeTimers();
    try {
      const { env, run } = envWith(new Promise(() => {}));
      const failure = expect(runPro('fix-grammar-pro', { text: 'Example' }, env)).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUTS.text);
      await failure;
      expect(run).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it.each([{ choices: [] }, { response: 'old schema' }, { choices: [{ finish_reason: 'stop', message: { content: null, reasoning_content: 'thinking' } }] }, { choices: [{ finish_reason: 'stop', message: { content: ' \t\n ' } }] }, { choices: [{ finish_reason: 'content_filter', message: { content: 'filtered' } }] }])('rejects missing or malformed answers', async result => {
    const { env } = envWith(result);
    await expect(runPro('deep-analysis-pro', { text: 'Document', question: 'Why?' }, env)).rejects.toThrow('Text model returned an incomplete or invalid answer');
  });

  it('accepts an answer with no reasoning', async () => {
    const { env } = envWith({ choices: [{ finish_reason: 'stop', message: { content: 'Answer' } }] });
    await expect(runPro('deep-analysis-pro', { text: 'Document', question: 'Why?' }, env)).resolves.toEqual({ answer: 'Answer', reasoning: '' });
  });

  it.each([
    ['fix-grammar-pro', { text: 'a'.repeat(4001) }],
    ['deep-analysis-pro', { text: 'a'.repeat(34001), question: 'Why?' }],
    ['deep-analysis-pro', { text: 'Doc', question: 'x'.repeat(1501) }],
    ['text-to-speech-pro', { text: 'é'.repeat(251) }],
    ['text-to-speech-pro', { text: 'ﬃ'.repeat(167) }],
  ])('enforces normalized byte limits before dispatch for %s', (id, input) => {
    const { env, run } = envWith({});
    expect(() => prepareProRun(id, input, env)).toThrow(/limit/);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects an unsupported voice language before inference', () => {
    const { env, run } = envWith({});
    expect(() => prepareProRun('text-to-speech-pro', { text: 'Bonjour', language: 'FR' }, env)).toThrow(/currently unavailable/);
    expect(run).not.toHaveBeenCalled();
  });

  it('returns the streamed Spanish MPEG bytes', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } });
    const { env, run } = envWith(stream);
    await expect(runPro('text-to-speech-pro', { text: 'Hola', language: 'ES' }, env)).resolves.toEqual({ contentType: 'audio/mpeg', base64: 'AQID' });
    expect(run).toHaveBeenCalledWith('@cf/deepgram/aura-2-es', { text: 'Hola', encoding: 'mp3', speaker: 'aquila' });
  });

  it('pins the English model and voice', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } });
    const { env, run } = envWith(stream);
    await runPro('text-to-speech-pro', { text: 'Hello' }, env);
    expect(run).toHaveBeenCalledWith('@cf/deepgram/aura-2-en', { text: 'Hello', encoding: 'mp3', speaker: 'luna' });
  });

  it('rejects non-stream output and stream failures', async () => {
    await expect(runPro('text-to-speech-pro', { text: 'hello' }, envWith({ audio: 'bad' }).env)).rejects.toThrow('TTS model returned invalid audio');
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('stream failed')); } });
    await expect(runPro('text-to-speech-pro', { text: 'hello' }, envWith(stream).env)).rejects.toThrow('stream failed');
  });

  it('rejects empty and oversized audio streams', async () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(TTS_MAX_AUDIO_BYTES + 1)]) {
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
      await expect(runPro('text-to-speech-pro', { text: 'hello' }, envWith(stream).env)).rejects.toThrow(bytes.length ? 'TTS audio exceeds size limit' : 'TTS model returned no audio');
    }
  });

  it('cancels an audio stream that stalls after inference', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    try {
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const promise = runPro('text-to-speech-pro', { text: 'hello' }, envWith(stream).env);
      const failure = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUTS.tts + 1);
      await failure;
      expect(cancel).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('cancels a stream arriving after inference timed out', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let resolve!: (stream: ReadableStream<Uint8Array>) => void;
    try {
      const pending = new Promise<ReadableStream<Uint8Array>>(r => { resolve = r; });
      const { env } = envWith(undefined);
      vi.spyOn(env.AI, 'run').mockReturnValue(pending);
      const promise = runPro('text-to-speech-pro', { text: 'hello' }, env);
      const failure = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUTS.tts + 1);
      await failure;
      resolve(new ReadableStream<Uint8Array>({ cancel }));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
