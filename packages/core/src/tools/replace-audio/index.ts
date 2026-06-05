import type { ToolModule, ToolRunContext } from '../../types.js';

// Replace-audio takes two files (a video and an audio track) and has no
// further configurable parameters — the operation is fully determined by the inputs.
export type ReplaceAudioParams = Record<string, never>;

export const defaultReplaceAudioParams: ReplaceAudioParams = {};

/**
 * Classify the two inputs into a video and an audio file by MIME type.
 * Order-independent: the user may drop them in either order. Throws unless
 * there is exactly one video and one audio file.
 */
export function pickVideoAudio(
  files: ReadonlyArray<{ type: string }>,
): { videoIndex: number; audioIndex: number } {
  const videoIdx = files.findIndex((f) => f.type.startsWith('video/'));
  const audioIdx = files.findIndex((f) => f.type.startsWith('audio/'));
  if (videoIdx === -1) throw new Error('Expected one video file');
  if (audioIdx === -1) throw new Error('Expected one audio file');
  if (videoIdx === audioIdx) throw new Error('Expected one video and one audio file');
  return { videoIndex: videoIdx, audioIndex: audioIdx };
}

/**
 * Mux the audio track over the video's picture. `-map 0:v:0 -map 1:a:0`
 * takes video from the first input and audio from the second; `-c:v copy`
 * leaves the picture untouched, audio is re-encoded to AAC, and
 * `-shortest` ends at whichever stream finishes first.
 */
export function buildReplaceAudioArgs(
  videoName: string,
  audioName: string,
  outputName: string,
): string[] {
  return [
    '-i', videoName,
    '-i', audioName,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    outputName,
  ];
}

export const replaceAudio: ToolModule<ReplaceAudioParams> = {
  id: 'replace-audio',
  slug: 'replace-audio',
  name: 'Replace Audio Track',
  description: 'Swap a video\'s audio for a new audio file. Drop in a video and an audio file (any order).',
  category: 'media',
  keywords: ['video', 'audio', 'replace', 'dub', 'soundtrack', 'mux', 'music', 'voiceover'],

  input: {
    accept: ['video/*', 'audio/*'],
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

  defaults: defaultReplaceAudioParams,

  async run(
    inputs: File[],
    _params: ReplaceAudioParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    const { videoIndex, audioIndex } = pickVideoAudio(inputs);
    const video = inputs[videoIndex]!;
    const audio = inputs[audioIndex]!;

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const videoExt = video.name.split('.').pop() ?? 'mp4';
    const audioExt = audio.name.split('.').pop() ?? 'mp3';
    const videoName = `video.${videoExt}`;
    const audioName = `audio.${audioExt}`;
    const outputName = 'output.mp4';

    await ff.writeFile(videoName, new Uint8Array(await video.arrayBuffer()));
    await ff.writeFile(audioName, new Uint8Array(await audio.arrayBuffer()));

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Muxing audio' });

    const args = buildReplaceAudioArgs(videoName, audioName, outputName);
    await ff.exec(args);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output as Uint8Array);

    await ff.deleteFile(videoName).catch(() => {});
    await ff.deleteFile(audioName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['video/mp4'],
  },
};
