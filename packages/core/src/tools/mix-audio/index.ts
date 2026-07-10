import type { ToolModule, ToolRunContext } from '../../types.js';

export interface MixAudioParams {
  musicVolume: number;
}

export const defaultMixAudioParams: MixAudioParams = {
  musicVolume: 0.3,
};

/**
 * Classify the two inputs into the video and the background-audio track by
 * MIME. Order-independent. Throws unless there is exactly one video and one
 * audio file.
 */
export function pickVideoAudio(
  files: ReadonlyArray<{ type: string }>,
): { videoIndex: number; audioIndex: number } {
  const videoIndex = files.findIndex((f) => f.type.startsWith('video/'));
  const audioIndex = files.findIndex((f) => f.type.startsWith('audio/'));
  if (videoIndex === -1) throw new Error('Expected one video file');
  if (audioIndex === -1) throw new Error('Expected one audio file');
  if (videoIndex === audioIndex) throw new Error('Expected one video and one audio file');
  return { videoIndex, audioIndex };
}

/**
 * Blend background music (input 1) under the video's own audio (input 0).
 * The music is attenuated by `musicVolume` so it sits below the original
 * sound, then `amix` combines the two; `duration=first` ends with the video.
 * The picture is copied through untouched.
 */
export function buildMixAudioArgs(
  videoName: string,
  musicName: string,
  outputName: string,
  musicVolume: number,
): string[] {
  const vol = Math.max(0, Math.min(2, musicVolume));
  const filter =
    `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
  return [
    '-i', videoName,
    '-i', musicName,
    '-filter_complex', filter,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    outputName,
  ];
}

export const mixAudio: ToolModule<MixAudioParams> = {
  id: 'mix-audio',
  slug: 'mix-audio',
  name: 'Mix Background Music',
  description: 'Lay a background music track under a video\'s existing audio. Drop a video and an audio file (any order).',
  category: 'media',
  categories: ['audio'],
  keywords: ['video', 'audio', 'mix', 'background', 'music', 'overlay', 'soundtrack', 'duck', 'blend'],

  input: { accept: ['video/*', 'audio/*'], min: 2, max: 2, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultMixAudioParams,

  paramSchema: {
    musicVolume: {
      type: 'range',
      label: 'Music volume',
      min: 0,
      max: 1,
      step: 0.05,
      help: 'How loud the background music sits under the original audio.',
    },
  },

  async run(inputs: File[], params: MixAudioParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    const { videoIndex, audioIndex } = pickVideoAudio(inputs);
    const video = inputs[videoIndex]!;
    const music = inputs[audioIndex]!;

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const videoName = `video.${video.name.split('.').pop() ?? 'mp4'}`;
    const musicName = `music.${music.name.split('.').pop() ?? 'mp3'}`;
    const outputName = 'output.mp4';

    await ff.writeFile(videoName, new Uint8Array(await video.arrayBuffer()));
    await ff.writeFile(musicName, new Uint8Array(await music.arrayBuffer()));

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Mixing audio' });

    await ff.exec(buildMixAudioArgs(videoName, musicName, outputName, params.musicVolume));
    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output);

    await ff.deleteFile(videoName).catch(() => {});
    await ff.deleteFile(musicName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['video/mp4'] },
};
