import type { ToolModule, ToolRunContext } from '../../types.js';

// Mute has no configurable parameters — it strips the audio stream wholesale.
export type MuteVideoParams = Record<string, never>;

export const defaultMuteVideoParams: MuteVideoParams = {};

function getMimeFromFile(file: File): string {
  return file.type || 'application/octet-stream';
}

function getExtFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'bin') : 'bin';
}

/**
 * Strip the audio stream while stream-copying the video — no re-encode,
 * so it is near-instant and lossless. `-an` drops audio; `-c copy`
 * passes the video through untouched.
 */
export function buildMuteArgs(inputName: string, outputName: string): string[] {
  return [
    '-i', inputName,
    '-c', 'copy',
    '-an',
    outputName,
  ];
}

export const muteVideo: ToolModule<MuteVideoParams> = {
  id: 'mute-video',
  slug: 'mute-video',
  name: 'Mute Video',
  description: 'Remove the audio track from a video. Keeps the original video stream untouched (no re-encode).',
  category: 'media',
  keywords: ['video', 'mute', 'silence', 'remove audio', 'strip audio', 'no sound'],

  input: {
    accept: ['video/*'],
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

  defaults: defaultMuteVideoParams,

  async run(
    inputs: File[],
    _params: MuteVideoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = getExtFromFile(input);
    const inputName = `input.${ext}`;
    const outputName = `output.${ext}`;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Removing audio' });

    const args = buildMuteArgs(inputName, outputName);
    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getMimeFromFile(input) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['video/mp4'],
  },
};
