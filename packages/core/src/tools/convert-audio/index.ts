import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'm4a' | 'opus';

export interface ConvertAudioParams {
  format: AudioFormat;
  bitrate?: string;
}

export const defaultConvertAudioParams: ConvertAudioParams = {
  format: 'mp3',
  bitrate: '192k',
};

const CONVERT_AUDIO_BUDGET: ToolBudget = { maxDuration: 14_400 };

const FORMAT_MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/ogg; codecs=opus',
};

const FORMAT_CODEC: Record<AudioFormat, string> = {
  mp3: 'libmp3lame',
  wav: 'pcm_s16le',
  ogg: 'libvorbis',
  flac: 'flac',
  aac: 'aac',
  m4a: 'aac',
  opus: 'libopus',
};

export function getAudioCodec(format: AudioFormat): string {
  return FORMAT_CODEC[format];
}

export function getAudioMime(format: AudioFormat): string {
  return FORMAT_MIME[format];
}

export const convertAudio: ToolModule<ConvertAudioParams> = {
  id: 'convert-audio',
  slug: 'convert-audio',
  name: 'Convert Audio',
  description: 'Convert audio files between MP3, WAV, OGG, FLAC, AAC, M4A, and Opus formats.',
  category: 'media',
  keywords: ['audio', 'convert', 'mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'format'],

  input: {
    accept: ['audio/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'audio/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: CONVERT_AUDIO_BUDGET,

  defaults: defaultConvertAudioParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'format',
      options: [
        { value: 'mp3', label: 'MP3' },
        { value: 'wav', label: 'WAV' },
        { value: 'ogg', label: 'OGG' },
        { value: 'flac', label: 'FLAC' },
        { value: 'aac', label: 'AAC' },
        { value: 'm4a', label: 'M4A' },
        { value: 'opus', label: 'Opus' },
      ],
    },
    bitrate: {
      type: 'enum',
      label: 'bitrate',
      help: 'Only applies to lossy formats (not WAV/FLAC).',
      options: [
        { value: '96k', label: '96 kbps' },
        { value: '128k', label: '128 kbps' },
        { value: '192k', label: '192 kbps' },
        { value: '256k', label: '256 kbps' },
        { value: '320k', label: '320 kbps' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: ConvertAudioParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, probeDuration } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = input.name.split('.').pop() ?? 'audio';
    const inputName = `input.${ext}`;
    const outputName = `output.${params.format}`;

    // Write once, probe duration, then transform.
    await ff.writeFile(inputName, inputBytes);
    const durationSec = await probeDuration(ff, inputName);
    if (!isNaN(durationSec)) {
      assertDurationBudget(durationSec, CONVERT_AUDIO_BUDGET);
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Converting audio' });

    const codec = getAudioCodec(params.format);
    const args = ['-i', inputName, '-acodec', codec];

    // Only pass bitrate for lossy formats (not wav/flac)
    if (params.bitrate && !['wav', 'flac'].includes(params.format)) {
      args.push('-b:a', params.bitrate);
    }

    args.push(outputName);

    await ff.exec(args);
    const output = await ff.readFile(outputName);
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
    const outputBytes = typeof output === 'string'
      ? new TextEncoder().encode(output)
      : (output as Uint8Array);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getAudioMime(params.format) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['audio/mpeg'],
  },
};
