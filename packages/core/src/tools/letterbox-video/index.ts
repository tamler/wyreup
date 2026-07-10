import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const LETTERBOX_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export type LetterboxAspect = '16:9' | '9:16' | '1:1' | '4:3';

export interface LetterboxVideoParams {
  aspect: LetterboxAspect;
}

export const defaultLetterboxVideoParams: LetterboxVideoParams = {
  aspect: '16:9',
};

/** Target canvas per aspect ratio. */
export const LETTERBOX_CANVAS: Record<LetterboxAspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '4:3': { w: 1440, h: 1080 },
};

/**
 * Fit the whole frame inside the target canvas and pad the leftover space with
 * black bars (letterbox/pillarbox). `force_original_aspect_ratio=decrease`
 * scales down to fit without cropping; `pad` centres it on the canvas.
 */
export function buildLetterboxArgs(
  inputName: string,
  outputName: string,
  aspect: LetterboxAspect,
): string[] {
  const canvas = LETTERBOX_CANVAS[aspect];
  if (!canvas) throw new Error(`Unknown aspect: ${aspect}`);
  const { w, h } = canvas;
  return [
    '-i',
    inputName,
    '-vf',
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'fast',
    '-c:a',
    'copy',
    outputName,
  ];
}

export const letterboxVideo: ToolModule<LetterboxVideoParams> = {
  id: 'letterbox-video',
  slug: 'letterbox-video',
  name: 'Letterbox / Pillarbox',
  description:
    'Fit a video to a target aspect ratio (16:9, 9:16, 1:1, 4:3) with black bars — no cropping.',
  category: 'media',
  categories: ['edit'],
  keywords: [
    'video',
    'letterbox',
    'pillarbox',
    'aspect ratio',
    'bars',
    'pad',
    'reframe',
    'square',
    'vertical',
  ],

  input: { accept: ['video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: LETTERBOX_VIDEO_BUDGET,

  defaults: defaultLetterboxVideoParams,

  paramSchema: {
    aspect: {
      type: 'enum',
      label: 'Aspect ratio',
      options: [
        { value: '16:9', label: '16:9 (landscape)' },
        { value: '9:16', label: '9:16 (vertical / reels)' },
        { value: '1:1', label: '1:1 (square)' },
        { value: '4:3', label: '4:3 (classic)' },
      ],
    },
  },

  async run(inputs: File[], params: LetterboxVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
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
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, LETTERBOX_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Letterboxing' });

    await ff.exec(buildLetterboxArgs(inputName, outputName, params.aspect));
    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : output;

    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['video/mp4'] },
};
