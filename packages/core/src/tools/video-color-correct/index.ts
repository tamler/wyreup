import type { ToolModule, ToolRunContext } from '../../types.js';

export interface VideoColorCorrectParams {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  hueShift?: number;
  crf?: number;
}

export const defaultVideoColorCorrectParams: VideoColorCorrectParams = {
  brightness: 0,
  contrast: 1.0,
  saturation: 1.0,
  gamma: 1.0,
  hueShift: 0,
  crf: 23,
};

export function buildColorCorrectFilter(params: VideoColorCorrectParams): string {
  const brightness = params.brightness ?? 0;
  const contrast = params.contrast ?? 1.0;
  const saturation = params.saturation ?? 1.0;
  const gamma = params.gamma ?? 1.0;
  const hueShift = params.hueShift ?? 0;

  let filter = `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}`;

  if (hueShift !== 0) {
    filter += `,hue=h=${hueShift}`;
  }

  return filter;
}

export const videoColorCorrect: ToolModule<VideoColorCorrectParams> = {
  id: 'video-color-correct',
  slug: 'video-color-correct',
  name: 'Color Correct Video',
  description: 'Adjust brightness, contrast, saturation, gamma, and hue of a video.',
  category: 'media',
  keywords: ['video', 'color', 'correction', 'brightness', 'contrast', 'saturation', 'hue', 'gamma', 'grade'],

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

  defaults: defaultVideoColorCorrectParams,

  paramSchema: {
    brightness: {
      type: 'range',
      label: 'Brightness',
      help: '0 = no change. Negative = darker, positive = brighter.',
      min: -1.0,
      max: 1.0,
      step: 0.05,
    },
    contrast: {
      type: 'range',
      label: 'Contrast',
      help: '1.0 = no change.',
      min: -2.0,
      max: 2.0,
      step: 0.1,
    },
    saturation: {
      type: 'range',
      label: 'Saturation',
      help: '1.0 = no change. 0 = grayscale.',
      min: 0,
      max: 3.0,
      step: 0.1,
    },
    gamma: {
      type: 'range',
      label: 'Gamma',
      help: '1.0 = no change.',
      min: 0.1,
      max: 10.0,
      step: 0.1,
    },
    hueShift: {
      type: 'range',
      label: 'Hue shift',
      min: 0,
      max: 360,
      step: 1,
      unit: 'deg',
    },
    crf: {
      type: 'range',
      label: 'CRF',
      min: 0,
      max: 51,
      step: 1,
    },
  },

  async run(
    inputs: File[],
    params: VideoColorCorrectParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const ext = input.name.split('.').pop() ?? 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing input' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    await ff.writeFile(inputName, inputBytes);

    if (ctx.signal.aborted) {
      await ff.deleteFile(inputName).catch(() => {});
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Applying color correction' });

    const vfFilter = buildColorCorrectFilter(params);
    const crf = params.crf ?? 23;

    await ff.exec([
      '-i', inputName,
      '-vf', vfFilter,
      '-crf', String(crf),
      '-preset', 'fast',
      '-c:a', 'copy',
      outputName,
    ]);

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
