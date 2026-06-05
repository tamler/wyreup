import type { ToolModule, ToolRunContext } from '../../types.js';

export interface LoopVideoParams {
  loops: number;
}

export const defaultLoopVideoParams: LoopVideoParams = {
  loops: 2,
};

function getMimeFromFile(file: File): string {
  return file.type || 'application/octet-stream';
}

function getExtFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'bin') : 'bin';
}

/**
 * Repeat the clip. `-stream_loop N` plays the input N extra times (so the clip
 * appears N+1 times total); placed before `-i`. Stream-copied, so it is fast
 * and lossless. `loops` is clamped to a sane 1..100 range.
 */
export function buildLoopArgs(
  inputName: string,
  outputName: string,
  loops: number,
): string[] {
  const n = Math.max(1, Math.min(100, Math.round(loops)));
  return [
    '-stream_loop', String(n),
    '-i', inputName,
    '-c', 'copy',
    outputName,
  ];
}

export const loopVideo: ToolModule<LoopVideoParams> = {
  id: 'loop-video',
  slug: 'loop-video',
  name: 'Loop Video',
  description: 'Repeat a video (or audio) clip back-to-back a number of times.',
  category: 'media',
  categories: ['edit'],
  keywords: ['video', 'loop', 'repeat', 'duplicate', 'replay', 'audio'],

  input: { accept: ['audio/*', 'video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: '*/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultLoopVideoParams,

  paramSchema: {
    loops: {
      type: 'number',
      label: 'Extra repeats',
      help: 'Number of additional plays. 2 = the clip appears 3 times total.',
    },
  },

  async run(inputs: File[], params: LoopVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = getExtFromFile(input);
    const inputName = `input.${ext}`;
    const outputName = `output.${ext}`;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Looping' });

    const args = buildLoopArgs(inputName, outputName, params.loops);
    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getMimeFromFile(input) })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['video/mp4'] },
};
