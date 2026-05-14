import type { ToolModule, ToolRunContext } from '../../types.js';

export type ExtractAudioFormat = 'mp3' | 'wav' | 'ogg' | 'm4a';

export interface ExtractAudioParams {
  format: ExtractAudioFormat;
  bitrate?: string;
}

export const defaultExtractAudioParams: ExtractAudioParams = {
  format: 'mp3',
  bitrate: '192k',
};

const FORMAT_MIME: Record<ExtractAudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
};

const FORMAT_CODEC: Record<ExtractAudioFormat, string> = {
  mp3: 'libmp3lame',
  wav: 'pcm_s16le',
  ogg: 'libvorbis',
  m4a: 'aac',
};

export function getExtractCodec(format: ExtractAudioFormat): string {
  return FORMAT_CODEC[format];
}

export function getExtractMime(format: ExtractAudioFormat): string {
  return FORMAT_MIME[format];
}

export const extractAudio: ToolModule<ExtractAudioParams> = {
  id: 'extract-audio',
  slug: 'extract-audio',
  name: 'Extract Audio',
  description: 'Strip the audio track from a video file. Outputs MP3, WAV, OGG, or M4A.',
  category: 'media',
  keywords: ['audio', 'extract', 'video', 'strip', 'mp3', 'wav', 'sound', 'rip'],

  input: {
    accept: ['video/*'],
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

  defaults: defaultExtractAudioParams,

  async run(
    inputs: File[],
    params: ExtractAudioParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = input.name.split('.').pop() ?? 'video';
    const inputName = `input.${ext}`;
    const outputName = `output.${params.format}`;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Extracting audio' });

    const codec = getExtractCodec(params.format);
    const args = ['-i', inputName, '-vn', '-acodec', codec];

    if (params.bitrate && !['wav'].includes(params.format)) {
      args.push('-b:a', params.bitrate);
    }

    args.push(outputName);

    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getExtractMime(params.format) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['audio/mpeg'],
  },
};
