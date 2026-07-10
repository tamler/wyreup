import type { ToolModule, ToolRunContext } from '../../types.js';

export type LoudnessPreset =
  | 'ebu-r128'
  | 'atsc-a85'
  | 'spotify'
  | 'apple-music'
  | 'youtube'
  | 'amazon';

export interface NormalizeLoudnessParams {
  preset: LoudnessPreset;
}

export const defaultNormalizeLoudnessParams: NormalizeLoudnessParams = {
  preset: 'spotify',
};

/** Integrated loudness (LUFS) and true-peak (dBTP) targets per platform. */
export const LOUDNESS_TARGETS: Record<LoudnessPreset, { I: number; TP: number }> = {
  'ebu-r128': { I: -23, TP: -1.0 },
  'atsc-a85': { I: -24, TP: -2.0 },
  spotify: { I: -14, TP: -1.0 },
  'apple-music': { I: -16, TP: -1.0 },
  youtube: { I: -14, TP: -1.0 },
  amazon: { I: -14, TP: -2.0 },
};

const LRA_TARGET = 11;

function getMimeFromFile(file: File): string {
  return file.type || 'application/octet-stream';
}

function getExtFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'bin') : 'bin';
}

/**
 * Build single-pass `loudnorm` (EBU R128) args for a preset. When the input
 * carries a video stream, the picture is copied through untouched and only
 * the audio is normalized. (Two-pass measure-then-apply is a future accuracy
 * improvement; single-pass is deterministic and needs no log round-trip.)
 */
export function buildLoudnormArgs(
  inputName: string,
  outputName: string,
  preset: LoudnessPreset,
  hasVideo: boolean,
): string[] {
  const target = LOUDNESS_TARGETS[preset];
  if (!target) throw new Error(`Unknown loudness preset: ${preset}`);
  const args = ['-i', inputName];
  if (hasVideo) args.push('-c:v', 'copy');
  args.push('-af', `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${LRA_TARGET}`, outputName);
  return args;
}

export const normalizeLoudness: ToolModule<NormalizeLoudnessParams> = {
  id: 'normalize-loudness',
  slug: 'normalize-loudness',
  name: 'Normalize Loudness',
  description:
    'Level audio or video to a broadcast/streaming loudness target (EBU R128, Spotify, Apple Music, and more).',
  category: 'media',
  categories: ['audio'],
  keywords: [
    'loudness',
    'normalize',
    'lufs',
    'ebu',
    'r128',
    'audio',
    'video',
    'volume',
    'loudnorm',
  ],

  input: {
    accept: ['audio/*', 'video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: '*/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultNormalizeLoudnessParams,

  paramSchema: {
    preset: {
      type: 'enum',
      label: 'Target',
      help: 'Loudness standard to normalize to.',
      options: [
        { value: 'spotify', label: 'Spotify (−14 LUFS)' },
        { value: 'apple-music', label: 'Apple Music (−16 LUFS)' },
        { value: 'youtube', label: 'YouTube (−14 LUFS)' },
        { value: 'amazon', label: 'Amazon Music (−14 LUFS)' },
        { value: 'ebu-r128', label: 'EBU R128 broadcast (−23 LUFS)' },
        { value: 'atsc-a85', label: 'ATSC A/85 broadcast (−24 LUFS)' },
      ],
    },
  },

  async run(inputs: File[], params: NormalizeLoudnessParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = getExtFromFile(input);
    const inputName = `input.${ext}`;
    const outputName = `output.${ext}`;
    const hasVideo = (input.type || '').startsWith('video/');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Normalizing loudness' });

    const args = buildLoudnormArgs(inputName, outputName, params.preset, hasVideo);
    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getMimeFromFile(input) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['audio/mpeg'],
  },
};
