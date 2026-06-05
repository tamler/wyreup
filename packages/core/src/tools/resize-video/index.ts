import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const RESIZE_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export interface ResizeVideoParams {
  width?: number;
  height?: number;
  crf?: number;
}

export const defaultResizeVideoParams: ResizeVideoParams = {
  width: 1280,
  height: undefined,
  crf: 23,
};

/**
 * Build the scale filter target. A blank dimension becomes `-2`, which
 * tells ffmpeg to preserve the aspect ratio while keeping the value
 * divisible by 2 (required by H.264). At least one of width/height must
 * be a positive number.
 */
export function buildScaleFilter(width?: number, height?: number): string {
  const w = width && width > 0 ? Math.round(width) : -2;
  const h = height && height > 0 ? Math.round(height) : -2;
  if (w === -2 && h === -2) {
    throw new Error('Provide at least one of width or height');
  }
  return `scale=${w}:${h}`;
}

export function buildResizeArgs(
  inputName: string,
  outputName: string,
  params: ResizeVideoParams,
): string[] {
  const crf = params.crf ?? 23;
  return [
    '-i', inputName,
    '-vf', buildScaleFilter(params.width, params.height),
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', 'fast',
    '-c:a', 'copy',
    outputName,
  ];
}

export const resizeVideo: ToolModule<ResizeVideoParams> = {
  id: 'resize-video',
  slug: 'resize-video',
  name: 'Resize Video',
  description: 'Scale a video to new dimensions. Leave width or height blank to preserve the aspect ratio.',
  category: 'media',
  keywords: ['video', 'resize', 'scale', 'dimensions', 'width', 'height', 'shrink', 'downscale'],

  input: {
    accept: ['video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: RESIZE_VIDEO_BUDGET,

  defaults: defaultResizeVideoParams,

  paramSchema: {
    width: {
      type: 'number',
      label: 'Width (px)',
      help: 'Leave blank to scale by height and keep aspect ratio.',
    },
    height: {
      type: 'number',
      label: 'Height (px)',
      help: 'Leave blank to scale by width and keep aspect ratio.',
    },
    crf: {
      type: 'range',
      label: 'CRF',
      min: 0,
      max: 51,
      step: 1,
      help: 'Higher = smaller file, lower quality.',
    },
  },

  async run(
    inputs: File[],
    params: ResizeVideoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, probeDuration } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const ext = input.name.split('.').pop() ?? 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    await ff.writeFile(inputName, inputBytes);

    const durationSec = await probeDuration(ff, inputName);
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, RESIZE_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Resizing' });

    const args = buildResizeArgs(inputName, outputName, params);
    await ff.exec(args);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output as Uint8Array);

    await ff.deleteFile(inputName).catch(() => {});
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
