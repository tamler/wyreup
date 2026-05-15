import type { ToolModule, ToolRunContext } from '../../types.js';
import type { InferenceSession as OnnxInferenceSession } from 'onnxruntime-web';
import { modelUrl } from '../../lib/model-cdn.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AudioEnhanceParams {
  // FlashSR has no configurable parameters — it is a single-purpose 16 kHz → 48 kHz upscaler.
  // Reserved for future: e.g. output_sample_rate?: 48000 | 44100
}

export const defaultAudioEnhanceParams: AudioEnhanceParams = {};

const ACCEPTED_MIME_TYPES = [
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
];

// Resolved via model-cdn.ts at fetch time (not module load) so a
// setModelCdn() call after this module is imported still takes effect.
const FLASHSR_MODEL_PATH = 'YatharthS/FlashSR/resolve/main/onnx/model.onnx';
const FLASHSR_MODEL_UPSTREAM = `https://huggingface.co/${FLASHSR_MODEL_PATH}`;

// ──── WAV encoder ────

/**
 * Encode a Float32Array of audio samples into a standard PCM WAV blob.
 * PCM 16-bit, mono, at the given sample rate.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit PCM
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);         // subchunk1 size
  view.setUint16(20, 1, true);          // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);         // bits per sample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples — clamp to [-1, 1] then convert to int16
  const pcmOffset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    const int16 = Math.round(clamped * 32767);
    view.setInt16(pcmOffset + i * 2, int16, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

// ──── Resample helper ────

/**
 * Resample a Float32Array from sourceSR to targetSR via linear interpolation.
 * Used as a fallback when AudioContext ignores the sampleRate option.
 */
export function resample(
  input: Float32Array,
  sourceSR: number,
  targetSR: number,
): Float32Array {
  if (sourceSR === targetSR) return input;
  const ratio = sourceSR / targetSR;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    const t = pos - lo;
    output[i] = input[lo]! * (1 - t) + input[hi]! * t;
  }
  return output;
}

// ──── Audio decode (browser-only path) ────

/**
 * Decode an audio blob to a mono Float32Array at 16 kHz.
 * Uses the Web Audio API — not available in Node. Returns null in Node.
 */
async function decodeToMono16k(blob: Blob): Promise<Float32Array | null> {
  const AudioCtx =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
      : null;

  if (!AudioCtx) return null;

  const TARGET_SR = 16000;
  const audioCtx = new AudioCtx({ sampleRate: TARGET_SR });
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  // Mix to mono
  const channelCount = decoded.numberOfChannels;
  const length = decoded.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channelCount; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      (mono as Float32Array)[i] = ((mono as Float32Array)[i] ?? 0) + (data[i] ?? 0) / channelCount;
    }
  }
  await audioCtx.close();

  // AudioContext may ignore the requested sampleRate in some browsers.
  // If the decoded rate differs from 16 kHz, resample manually.
  if (decoded.sampleRate !== TARGET_SR) {
    return resample(mono, decoded.sampleRate, TARGET_SR);
  }

  return mono;
}

// ──── ONNX session (cached per ToolRunContext) ────

type InferenceSession = OnnxInferenceSession;

async function getSession(ctx: ToolRunContext): Promise<InferenceSession> {
  const cached = ctx.cache.get('audio-enhance:session') as InferenceSession | undefined;
  if (cached) return cached;

  const ort = await import('onnxruntime-web');

  const res = await fetch(modelUrl(FLASHSR_MODEL_PATH, FLASHSR_MODEL_UPSTREAM));
  if (!res.ok) {
    throw new Error(
      `Failed to load FlashSR model (HTTP ${res.status}). Check your network connection and try again.`,
    );
  }
  const buffer = await res.arrayBuffer();

  let session: InferenceSession;
  try {
    session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['webgpu', 'wasm'],
    });
  } catch {
    session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
    });
  }

  ctx.cache.set('audio-enhance:session', session);
  return session;
}

// ──── Component stub ────

// ──── Tool module ────

export const audioEnhance: ToolModule<AudioEnhanceParams> = {
  id: 'audio-enhance',
  slug: 'audio-enhance',
  name: 'Enhance Audio',
  description:
    'Upscale low-quality audio to clean 48 kHz. Great for cleaning up phone recordings, Zoom calls, or old podcasts.',
  llmDescription:
    'Enhance audio quality using AI super-resolution (FlashSR, 16kHz to 48kHz upsampling). Use when the user wants higher quality audio from a low-quality recording. CPU/GPU-intensive — may take several seconds.',
  category: 'audio',
  keywords: [
    'audio',
    'enhance',
    'upscale',
    'super-resolution',
    'restore',
    'clean',
    'denoise',
    'hi-fi',
  ],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024, // 100 MB
  },
  output: { mime: 'audio/wav' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 15_500_000, // ~15 MB onnxruntime-web WASM + ~500 KB FlashSR ONNX model
  requires: { webgpu: 'preferred' },

  defaults: defaultAudioEnhanceParams,

  async run(
    inputs: File[],
    _params: AudioEnhanceParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('audio-enhance accepts exactly one audio file.');
    }
    const input = inputs[0]!;
    if (!ACCEPTED_MIME_TYPES.includes(input.type)) {
      throw new Error(
        `Unsupported input type: ${input.type}. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`,
      );
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading FlashSR model' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    // Decode audio to 16 kHz mono Float32Array
    const mono16k = await decodeToMono16k(input);
    if (!mono16k) {
      throw new Error(
        'Audio decoding requires a browser environment with Web Audio API. ' +
        'The audio-enhance tool is not supported in the current environment.',
      );
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 30, message: 'Model ready — running inference' });

    const session = await getSession(ctx);

    if (ctx.signal.aborted) throw new Error('Aborted');

    // Check for a fixed input length constraint in the model
    const inputName = session.inputNames[0]!;
    const outputName = session.outputNames[0]!;

    // FlashSR v1: no chunking. If the model has a fixed max input dimension,
    // surface a clear error rather than silently producing bad output.
    // Typical FlashSR ONNX models accept dynamic-length input [1, n_samples].
    // inputMetadata is a readonly ValueMetadata[] (array, not a Record).
    // Find the entry whose name matches inputName.
    const inputMeta = session.inputMetadata?.find?.(
      (m: { name?: string }) => m.name === inputName,
    ) as { shape?: (number | bigint | string | null)[] } | undefined;
    if (inputMeta?.shape) {
      const fixedLen = inputMeta.shape[1];
      if (typeof fixedLen === 'number' && fixedLen > 0 && mono16k.length > fixedLen) {
        throw new Error(
          `Audio file too long for single-pass enhancement (input: ${mono16k.length} samples, ` +
          `model max: ${fixedLen}). Please split into shorter segments.`,
        );
      }
    }

    const ort = await import('onnxruntime-web');
    const tensor = new ort.Tensor('float32', mono16k, [1, mono16k.length]);

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Enhancing audio' });

    const result = await session.run({ [inputName]: tensor });
    const output48k = result[outputName]!.data as Float32Array;

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Encoding output WAV' });

    const wavBlob = encodeWav(output48k, 48000);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    return [wavBlob];
  },

  __testFixtures: {
    valid: ['tone-16k.wav'],
    weird: [],
    expectedOutputMime: ['audio/wav'],
  },
};
