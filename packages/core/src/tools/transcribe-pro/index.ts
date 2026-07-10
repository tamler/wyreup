import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

// transcribe-pro: hosted Whisper-large-v3 via Wyreup PRO.
//
// Credit-gated companion to the free in-browser `transcribe` tool.
// Runs on web (wyreup_session cookie), CLI, and MCP (Bearer key from
// `wyreup login` / WYREUP_API_KEY) — auth and balance refresh are
// handled by `runPro` in lib/pro-runner.ts.

export interface TranscribeProParams {
  language?: string;
}

export const defaultTranscribeProParams: TranscribeProParams = {
  language: 'en',
};

export const transcribePro: ToolModule<TranscribeProParams> = {
  id: 'transcribe-pro',
  slug: 'transcribe-pro',
  name: 'Transcribe Audio',
  description:
    'Hosted Whisper-large-v3 transcription — higher accuracy and better with' +
    ' noisy or accented speech than the free in-browser version. Uses 3 credits per run.',
  category: 'export',
  keywords: ['transcribe', 'whisper', 'speech', 'pro', 'hosted', 'large', 'audio'],

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
  creditCost: 3,
  memoryEstimate: 'low', // server does the heavy lifting

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

  async run(inputs: File[], params: TranscribeProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) {
      throw new Error('transcribe-pro accepts exactly one audio file.');
    }
    const input = inputs[0]!;
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Uploading audio' });
    const audioBase64 = await fileToBase64(input);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 40,
      message: 'Running hosted Whisper-large',
    });

    const result = await runPro<{ text: string }>(
      'transcribe-pro',
      {
        audioBase64,
        language: params.language ?? 'en',
        fileName: input.name,
      },
      ctx,
    );

    if (typeof result.text !== 'string') {
      throw new Error('Hosted transcribe returned no text');
    }

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
