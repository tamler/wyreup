import type { ToolModule, ToolRunContext } from '../../types.js';

export interface BurnSubtitlesParams {
  fontSize?: number;
  crf?: number;
}

export const defaultBurnSubtitlesParams: BurnSubtitlesParams = {
  fontSize: 16,
  crf: 23,
};

const BurnSubtitlesComponentStub = (): unknown => null;

export const burnSubtitles: ToolModule<BurnSubtitlesParams> = {
  id: 'burn-subtitles',
  slug: 'burn-subtitles',
  name: 'Burn Subtitles',
  description: 'Render subtitles permanently into a video (hardsub). Accepts SRT or WebVTT files.',
  category: 'media',
  presence: 'both',
  keywords: ['subtitles', 'hardsub', 'burn', 'srt', 'vtt', 'video', 'captions', 'embed'],

  input: {
    accept: ['video/*', 'text/vtt', 'application/x-subrip', 'text/plain'],
    min: 2,
    max: 2,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultBurnSubtitlesParams,

  Component: BurnSubtitlesComponentStub,

  async run(
    inputs: File[],
    params: BurnSubtitlesParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (inputs.length < 2) {
      throw new Error('burn-subtitles requires two files: a video and a subtitle file.');
    }

    // Determine which file is the video and which is the subtitle
    const videoFile = inputs.find((f) => f.type.startsWith('video/'));
    const subFile = inputs.find((f) => !f.type.startsWith('video/'));

    if (!videoFile || !subFile) {
      throw new Error('Please provide one video file and one subtitle file (SRT or VTT).');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const videoExt = videoFile.name.split('.').pop() ?? 'mp4';
    const subExt = subFile.name.split('.').pop() ?? 'srt';
    const inputName = `input.${videoExt}`;
    const subName = `subs.${subExt}`;
    const outputName = 'output.mp4';

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing files' });

    const videoBytes = new Uint8Array(await videoFile.arrayBuffer());
    const subBytes = new Uint8Array(await subFile.arrayBuffer());

    await ff.writeFile(inputName, videoBytes);
    await ff.writeFile(subName, subBytes);

    if (ctx.signal.aborted) {
      await ff.deleteFile(inputName);
      await ff.deleteFile(subName);
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Burning subtitles' });

    const fontSize = params.fontSize ?? 16;
    const crf = params.crf ?? 23;

    await ff.exec([
      '-i', inputName,
      '-vf', `subtitles=${subName}:force_style='FontSize=${fontSize}'`,
      '-crf', String(crf),
      '-preset', 'fast',
      outputName,
    ]);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array = typeof output === 'string' ? new TextEncoder().encode(output) : (output as Uint8Array);

    await ff.deleteFile(inputName);
    await ff.deleteFile(subName);
    await ff.deleteFile(outputName);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['video/mp4'],
  },
};
