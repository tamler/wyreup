import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';
import { convertVttToSrt } from '../convert-subtitles/index.js';

// transcribe-pro: hosted Whisper-large-v3 via Wyreup PRO.
//
// Credit-gated companion to the free in-browser `transcribe` tool.
// Runs on web (wyreup_session cookie), CLI, and MCP (Bearer key from
// `wyreup login` / WYREUP_API_KEY) — auth and balance refresh are
// handled by `runPro` in lib/pro-runner.ts.

export type TranscriptFormat = 'text' | 'srt' | 'vtt';

export interface TranscribeProParams {
  language?: string;
  /** Plain transcript, or timed subtitles from the model's WebVTT output. */
  format?: TranscriptFormat;
}

export const defaultTranscribeProParams: TranscribeProParams = {
  language: 'en',
  format: 'text',
};

export const transcribePro: ToolModule<TranscribeProParams> = {
  id: 'transcribe-pro',
  slug: 'transcribe-pro',
  name: 'Transcribe Audio',
  description:
    'Hosted Whisper large-v3 turbo transcription. Handles noisy or accented speech better than' +
    ' the free in-browser version, and can return SRT or WebVTT subtitles with timings.' +
    ' Uses 3 credits per run.',
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
    'burn-subtitles',
    'convert-subtitles',
    'text-summarize',
    'text-translate',
    'text-sentiment',
    'text-ner',
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
    format: {
      type: 'enum',
      label: 'output',
      help: 'Plain text, or subtitles with timings for a video. Same credit cost.',
      options: [
        { value: 'text', label: 'plain text' },
        { value: 'srt', label: 'SRT subtitles' },
        { value: 'vtt', label: 'WebVTT subtitles' },
      ],
    },
  },

  async run(inputs: File[], params: TranscribeProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) {
      throw new Error('transcribe-pro accepts exactly one audio file.');
    }
    const input = inputs[0]!;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const format = params.format ?? 'text';
    if (format !== 'text' && format !== 'srt' && format !== 'vtt') {
      throw new Error(`Unsupported output format: ${String(format)}`);
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Uploading audio' });
    const audioBase64 = await fileToBase64(input);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 40,
      message: 'Running hosted Whisper-large',
    });

    const result = await runPro<{ text: string; vtt?: string | null }>(
      'transcribe-pro',
      {
        audioBase64,
        language: params.language ?? 'en',
        format,
        fileName: input.name,
      },
      ctx,
    );

    if (typeof result.text !== 'string') {
      throw new Error('Hosted transcribe returned no text');
    }

    ctx.onProgress({ stage: 'done', percent: 100 });
    if (format === 'text') return new Blob([result.text], { type: 'text/plain' });

    // The server refuses (and refunds) a subtitle run without timings; this
    // guards an older server that ignores the format field.
    const vtt = typeof result.vtt === 'string' ? result.vtt.replace(/\r\n?/g, '\n') : '';
    if (!vtt.trim()) throw new Error('Hosted transcribe returned no subtitle timings');
    return format === 'vtt'
      ? new Blob([vtt], { type: 'text/vtt' })
      : new Blob([convertVttToSrt(vtt)], { type: 'application/x-subrip' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
