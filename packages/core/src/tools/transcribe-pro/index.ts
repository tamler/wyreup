import type { ToolModule, ToolRunContext } from '../../types.js';

// transcribe-pro: hosted Whisper-large-v3 via Wyreup PRO.
//
// This is the credit-gated companion to the free in-browser `transcribe`
// tool. The run() function posts the audio to /api/tools/pro/run; auth is
// handled by the wyreup_session cookie that the browser sets after the
// user activates an API key.
//
// CLI/MCP support is deferred: a `cost: 'credit'` tool needs to know the
// API key in non-browser contexts, which would require extending
// ToolRunContext. For v1 PRO ships browser-only via `surfaces: ['web']`.

export interface TranscribeProParams {
  language?: string;
}

export const defaultTranscribeProParams: TranscribeProParams = {
  language: 'en',
};

export const transcribePro: ToolModule<TranscribeProParams> = {
  id: 'transcribe-pro',
  slug: 'transcribe-pro',
  name: 'Transcribe Audio (PRO)',
  description:
    'Hosted Whisper-large-v3 transcription — higher accuracy and better with' +
    ' noisy or accented speech than the free in-browser version. Uses 5 credits per run.',
  category: 'export',
  keywords: [
    'transcribe',
    'whisper',
    'speech',
    'pro',
    'hosted',
    'large',
    'audio',
  ],

  input: {
    accept: [
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
    ],
    min: 1,
    max: 1,
    // 25 MB — Whisper API hard cap; larger files should use the free
    // in-browser transcribe (no upload limit since nothing leaves the tab).
    sizeLimit: 25 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 5,
  memoryEstimate: 'low', // server does the heavy lifting
  // Browser only for now — server-side auth depends on the wyreup_session
  // cookie. CLI/MCP variants ship when ToolRunContext carries an API key.
  surfaces: ['web'],

  chainSuggestions: [
    'text-summarize',
    'text-translate',
    'text-sentiment',
    'text-ner',
    'markdown-to-html',
  ],
  outputDisplay: 'prose',

  defaults: defaultTranscribeProParams,

  paramSchema: {
    language: {
      type: 'enum',
      label: 'language',
      help: 'Source language hint. "auto" is also supported but slower.',
      options: [
        { value: 'auto', label: 'auto-detect' },
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
        { value: 'fr', label: 'French' },
        { value: 'de', label: 'German' },
        { value: 'pt', label: 'Portuguese' },
        { value: 'it', label: 'Italian' },
        { value: 'ja', label: 'Japanese' },
        { value: 'zh', label: 'Chinese' },
        { value: 'ar', label: 'Arabic' },
        { value: 'hi', label: 'Hindi' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: TranscribeProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) {
      throw new Error('transcribe-pro accepts exactly one audio file.');
    }
    const input = inputs[0]!;
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Uploading audio' });

    const bytes = new Uint8Array(await input.arrayBuffer());
    const audioBase64 = uint8ArrayToBase64(bytes);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 40,
      message: 'Running hosted Whisper-large',
    });

    const res = await fetch('/api/tools/pro/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        toolId: 'transcribe-pro',
        input: {
          audioBase64,
          language: params.language ?? 'en',
          fileName: input.name,
        },
      }),
      signal: ctx.signal,
    });

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `Hosted transcribe failed (${res.status})`);
    }

    const body = (await res.json()) as { result?: { text?: string } };
    const text = body.result?.text;
    if (typeof text !== 'string') {
      throw new Error('Hosted transcribe returned no text');
    }

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};

function uint8ArrayToBase64(b: Uint8Array): string {
  // Workers and modern browsers both support this path. Chunked to avoid
  // RangeError on large files.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < b.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + CHUNK)));
  }
  return btoa(s);
}
