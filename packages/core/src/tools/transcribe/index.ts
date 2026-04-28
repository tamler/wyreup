import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface TranscribeParams {
  /**
   * Language hint for the model. 'auto' lets Whisper detect, but a specific
   * code is faster and usually more accurate. ISO 639-1 codes.
   */
  language?: string;
  /**
   * Whether to return timestamps alongside the transcript. When true, the
   * output is JSON with chunked segments; when false, plain text.
   */
  timestamps?: boolean;
  /**
   * 'transcribe' keeps the source language; 'translate' converts to English.
   */
  task?: 'transcribe' | 'translate';
}

export const defaultTranscribeParams: TranscribeParams = {
  language: 'en',
  timestamps: false,
  task: 'transcribe',
};

// Whisper-tiny — MIT-licensed, ~30 MB quantized.
// https://huggingface.co/Xenova/whisper-tiny
// Tiny is the right starting point: covers the speech-input category at
// the smallest possible footprint, and validates the install/consent UX
// before we add Whisper-base or Distil-Whisper as Tier-2 upgrades.
const MODEL_ID = 'Xenova/whisper-tiny';

const ACCEPTED_MIME_TYPES = [
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
];

// Top languages, English first. Whisper supports ~99 languages — keeping
// the picker short for now; expand if users ask for more.
const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ru', label: 'Russian' },
  { value: 'pl', label: 'Polish' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' },
];

const TranscribeComponentStub = (): unknown => null;

/**
 * Decode any browser-supported audio file to mono 16 kHz Float32Array,
 * which is what Whisper expects. Uses OfflineAudioContext for resampling
 * — no extra dependency needed.
 */
async function decodeToMono16k(buffer: ArrayBuffer): Promise<Float32Array> {
  if (typeof OfflineAudioContext === 'undefined' && typeof AudioContext === 'undefined') {
    throw new Error(
      'Web Audio API is unavailable in this environment. Transcribe requires a browser.',
    );
  }
  // Use a temporary context for the initial decode — sample rate doesn't
  // matter, we'll resample to 16k.
  const Ctor = (typeof AudioContext !== 'undefined' ? AudioContext : OfflineAudioContext) as
    | typeof AudioContext
    | typeof OfflineAudioContext;
  const tempCtx =
    Ctor === AudioContext
      ? new AudioContext()
      : new (Ctor as typeof OfflineAudioContext)(1, 1, 16000);
  const decoded = await tempCtx.decodeAudioData(buffer.slice(0));
  if (Ctor === AudioContext) await (tempCtx as AudioContext).close();

  // Resample to 16 kHz mono via OfflineAudioContext.
  const targetRate = 16000;
  const lengthAtTarget = Math.ceil(decoded.duration * targetRate);
  const offline = new OfflineAudioContext(1, lengthAtTarget, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;

  // Mix down to mono if needed.
  if (decoded.numberOfChannels > 1) {
    const merger = offline.createChannelMerger(1);
    source.connect(merger);
    merger.connect(offline.destination);
  } else {
    source.connect(offline.destination);
  }

  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

export const transcribe: ToolModule<TranscribeParams> = {
  id: 'transcribe',
  slug: 'transcribe',
  name: 'Transcribe Audio',
  description:
    'Convert speech to text using Whisper-tiny — runs entirely on your device. ' +
    '~80 MB model downloads on first use, then works offline.',
  category: 'export',
  presence: 'standalone',
  keywords: ['transcribe', 'speech', 'stt', 'whisper', 'audio', 'subtitles', 'voice'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 80_000_000,
  installGroup: 'speech',
  requires: { webgpu: 'preferred' },

  defaults: defaultTranscribeParams,

  paramSchema: {
    language: {
      type: 'enum',
      label: 'language',
      help: 'Source language. Auto-detect works but is slower; pick the actual language for best results.',
      options: LANGUAGE_OPTIONS,
    },
    task: {
      type: 'enum',
      label: 'task',
      help: '"Translate" converts non-English speech to English. Same model.',
      options: [
        { value: 'transcribe', label: 'transcribe (keep source language)' },
        { value: 'translate', label: 'translate to English' },
      ],
    },
    timestamps: {
      type: 'boolean',
      label: 'timestamps',
      help: 'Include per-segment timestamps in the output. Output becomes JSON instead of plain text.',
    },
  },

  Component: TranscribeComponentStub,

  async run(
    inputs: File[],
    params: TranscribeParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('transcribe accepts exactly one audio file.');
    }
    const input = inputs[0]!;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'loading-deps',
      percent: 0,
      message: 'Loading Whisper-tiny (~80 MB on first use)',
    });

    // dtype: pin per-component types to avoid the broken q4 merged-decoder
    // variant that auto-selection picks for some browsers / runtimes.
    // Symptom: ONNX Runtime crashes at session creation with
    //   "qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
    //    Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale"
    // because the merge optimization looks up a scale tensor that the
    // merged variant doesn't include. Encoder is fine at q8; decoder
    // merge needs fp32 to avoid the bad path.
    const pipe = await getPipeline(
      ctx,
      'automatic-speech-recognition',
      MODEL_ID,
      {
        dtype: {
          encoder_model: 'q8',
          decoder_model_merged: 'fp32',
        },
      },
    ) as (
      audio: Float32Array,
      options?: Record<string, unknown>,
    ) => Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> }>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 30,
      message: 'Decoding audio',
    });

    const audioBuffer = await input.arrayBuffer();
    const samples = await decodeToMono16k(audioBuffer);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({
      stage: 'processing',
      percent: 50,
      message: `Transcribing ${(samples.length / 16000).toFixed(1)}s of audio`,
    });

    const language = params.language ?? 'en';
    const task = params.task ?? 'transcribe';
    const wantTimestamps = params.timestamps === true;

    const options: Record<string, unknown> = {
      task,
      return_timestamps: wantTimestamps,
      // 30s chunks with 5s stride is the Whisper-recommended setting for
      // long-form audio.
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (language && language !== 'auto') options.language = language;

    const result = await pipe(samples, options);

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    if (wantTimestamps && result.chunks) {
      const json = JSON.stringify(
        { text: result.text, chunks: result.chunks },
        null,
        2,
      );
      return [new Blob([json], { type: 'application/json' })];
    }

    return [new Blob([result.text], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'application/json'],
  },
};
