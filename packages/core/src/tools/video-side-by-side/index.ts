import type { ToolModule, ToolRunContext } from '../../types.js';

export type StackOrientation = 'horizontal' | 'vertical';

export interface VideoSideBySideParams {
  orientation: StackOrientation;
}

export const defaultVideoSideBySideParams: VideoSideBySideParams = {
  orientation: 'horizontal',
};

/**
 * Place two clips next to each other. Horizontal (`hstack`) needs equal
 * heights, vertical (`vstack`) equal widths — so each clip is first scaled to a
 * common 720px on the shared axis (`-2` keeps the other side even + in ratio).
 * Audio is taken from the first clip. `shortest` ends with the briefer clip.
 */
export function buildSideBySideArgs(
  aName: string,
  bName: string,
  outputName: string,
  orientation: StackOrientation,
): string[] {
  const filter =
    orientation === 'vertical'
      ? '[0:v]scale=720:-2[t];[1:v]scale=720:-2[b];[t][b]vstack=inputs=2[v]'
      : '[0:v]scale=-2:720[l];[1:v]scale=-2:720[r];[l][r]hstack=inputs=2[v]';
  return [
    '-i',
    aName,
    '-i',
    bName,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'fast',
    '-shortest',
    outputName,
  ];
}

export const videoSideBySide: ToolModule<VideoSideBySideParams> = {
  id: 'video-side-by-side',
  slug: 'video-side-by-side',
  name: 'Side by Side',
  description:
    'Place two videos next to each other — horizontally or stacked vertically — into one clip.',
  category: 'media',
  categories: ['edit'],
  keywords: [
    'video',
    'side by side',
    'hstack',
    'vstack',
    'compare',
    'split screen',
    'stack',
    'grid',
  ],

  input: { accept: ['video/*'], min: 2, max: 2, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultVideoSideBySideParams,

  paramSchema: {
    orientation: {
      type: 'enum',
      label: 'Layout',
      options: [
        { value: 'horizontal', label: 'Side by side (horizontal)' },
        { value: 'vertical', label: 'Stacked (vertical)' },
      ],
    },
  },

  async run(inputs: File[], params: VideoSideBySideParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const a = inputs[0]!;
    const b = inputs[1]!;
    const aName = `a.${a.name.split('.').pop() ?? 'mp4'}`;
    const bName = `b.${b.name.split('.').pop() ?? 'mp4'}`;
    const outputName = 'output.mp4';

    await ff.writeFile(aName, new Uint8Array(await a.arrayBuffer()));
    await ff.writeFile(bName, new Uint8Array(await b.arrayBuffer()));

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Stacking videos' });

    await ff.exec(buildSideBySideArgs(aName, bName, outputName, params.orientation));
    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : output;

    await ff.deleteFile(aName).catch(() => {});
    await ff.deleteFile(bName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['video/mp4'] },
};
