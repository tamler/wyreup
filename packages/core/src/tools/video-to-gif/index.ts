import type { ToolModule, ToolRunContext } from '../../types.js';

export interface VideoToGifParams {
  fps?: number;
  width?: number;
  startSeconds?: number;
  durationSeconds?: number;
}

export const defaultVideoToGifParams: VideoToGifParams = {
  fps: 15,
  width: 480,
  startSeconds: 0,
  durationSeconds: 5,
};

export function buildGifArgs(
  inputName: string,
  outputName: string,
  params: VideoToGifParams,
): string[] {
  const fps = params.fps ?? 15;
  const width = params.width ?? 480;
  const start = params.startSeconds ?? 0;
  const duration = params.durationSeconds ?? 5;

  return [
    '-ss', String(start),
    '-t', String(duration),
    '-i', inputName,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    '-loop', '0',
    outputName,
  ];
}

export const videoToGif: ToolModule<VideoToGifParams> = {
  id: 'video-to-gif',
  slug: 'video-to-gif',
  name: 'Video to GIF',
  description: 'Convert a video clip to an animated GIF with palette optimization.',
  category: 'media',
  keywords: ['gif', 'video', 'animate', 'convert', 'loop', 'animated'],

  input: {
    accept: ['video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'image/gif' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultVideoToGifParams,

  async run(
    inputs: File[],
    params: VideoToGifParams,
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
    const outputName = 'output.gif';

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Converting to GIF' });

    const args = buildGifArgs(inputName, outputName, params);
    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'image/gif' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/gif'],
  },
};
