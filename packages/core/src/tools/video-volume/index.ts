import type { ToolModule, ToolRunContext } from '../../types.js';

export interface VideoVolumeParams {
  gain: number;
}

export const defaultVideoVolumeParams: VideoVolumeParams = {
  gain: 1.5,
};

function getMimeFromFile(file: File): string {
  return file.type || 'application/octet-stream';
}

function getExtFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'bin') : 'bin';
}

/**
 * Scale audio loudness by a linear gain factor (1 = unchanged, 2 = +6 dB,
 * 0.5 = −6 dB). Distinct from normalize-loudness, which targets an absolute
 * LUFS level. When the input has video the picture is copied through.
 */
export function buildVolumeArgs(
  inputName: string,
  outputName: string,
  gain: number,
  hasVideo: boolean,
): string[] {
  if (!(gain >= 0)) throw new Error('Gain must be >= 0');
  const args = ['-i', inputName];
  if (hasVideo) args.push('-c:v', 'copy');
  args.push('-af', `volume=${gain}`, outputName);
  return args;
}

export const videoVolume: ToolModule<VideoVolumeParams> = {
  id: 'video-volume',
  slug: 'video-volume',
  name: 'Adjust Volume',
  description: 'Make a video or audio file louder or quieter by a gain factor (1 = unchanged, 2 = double).',
  category: 'media',
  categories: ['audio'],
  keywords: ['volume', 'gain', 'louder', 'quieter', 'audio', 'video', 'boost', 'amplify', 'attenuate'],

  input: { accept: ['audio/*', 'video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: '*/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultVideoVolumeParams,

  paramSchema: {
    gain: {
      type: 'range',
      label: 'Gain',
      min: 0,
      max: 4,
      step: 0.1,
      help: '1 = unchanged, 2 = twice as loud, 0.5 = half.',
    },
  },

  async run(inputs: File[], params: VideoVolumeParams, ctx: ToolRunContext): Promise<Blob[]> {
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

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Adjusting volume' });

    const args = buildVolumeArgs(inputName, outputName, params.gain, hasVideo);
    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getMimeFromFile(input) })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['audio/mpeg'] },
};
