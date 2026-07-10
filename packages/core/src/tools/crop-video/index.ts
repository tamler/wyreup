import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const CROP_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export interface CropVideoParams {
  width: number;
  height: number;
  x: number;
  y: number;
}

export const defaultCropVideoParams: CropVideoParams = {
  width: 640,
  height: 480,
  x: 0,
  y: 0,
};

/**
 * Crop a rectangle from the frame. `crop=w:h:x:y` keeps the w×h region whose
 * top-left corner is at (x, y). Width/height must be positive; x/y are clamped
 * to ≥ 0 (ffmpeg rejects negative offsets).
 */
export function buildCropArgs(
  inputName: string,
  outputName: string,
  params: CropVideoParams,
): string[] {
  const w = Math.round(params.width);
  const h = Math.round(params.height);
  if (!(w > 0) || !(h > 0)) {
    throw new Error('Crop width and height must be positive');
  }
  const x = Math.max(0, Math.round(params.x ?? 0));
  const y = Math.max(0, Math.round(params.y ?? 0));
  return [
    '-i', inputName,
    '-vf', `crop=${w}:${h}:${x}:${y}`,
    '-c:v', 'libx264',
    '-crf', '23',
    '-preset', 'fast',
    '-c:a', 'copy',
    outputName,
  ];
}

export const cropVideo: ToolModule<CropVideoParams> = {
  id: 'crop-video',
  slug: 'crop-video',
  name: 'Crop Video',
  description: 'Cut a rectangular region out of a video. Set the crop width, height, and top-left position.',
  category: 'media',
  categories: ['edit'],
  keywords: ['video', 'crop', 'trim edges', 'cut', 'region', 'frame', 'reframe'],

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
  budget: CROP_VIDEO_BUDGET,

  defaults: defaultCropVideoParams,

  paramSchema: {
    width: { type: 'number', label: 'Crop width (px)' },
    height: { type: 'number', label: 'Crop height (px)' },
    x: { type: 'number', label: 'Left offset (px)' },
    y: { type: 'number', label: 'Top offset (px)' },
  },

  async run(inputs: File[], params: CropVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg, probeDuration } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const ext = input.name.split('.').pop() ?? 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    await ff.writeFile(inputName, new Uint8Array(await input.arrayBuffer()));
    const durationSec = await probeDuration(ff, inputName);
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, CROP_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Cropping' });

    await ff.exec(buildCropArgs(inputName, outputName, params));
    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output);

    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['video/mp4'] },
};
