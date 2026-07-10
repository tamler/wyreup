import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const ROTATE_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export type RotateMode = '90cw' | '90ccw' | '180' | 'flip-h' | 'flip-v' | 'flip-both';

export interface RotateVideoParams {
  mode: RotateMode;
}

export const defaultRotateVideoParams: RotateVideoParams = {
  mode: '90cw',
};

const ROTATE_FILTERS: Record<RotateMode, string> = {
  '90cw': 'transpose=1',
  '90ccw': 'transpose=2',
  '180': 'transpose=1,transpose=1',
  'flip-h': 'hflip',
  'flip-v': 'vflip',
  'flip-both': 'hflip,vflip',
};

export function getRotateFilter(mode: RotateMode): string {
  const filter = ROTATE_FILTERS[mode];
  if (!filter) throw new Error(`Unknown rotate mode: ${mode}`);
  return filter;
}

export function buildRotateArgs(
  inputName: string,
  outputName: string,
  params: RotateVideoParams,
): string[] {
  return [
    '-i', inputName,
    '-vf', getRotateFilter(params.mode),
    '-c:v', 'libx264',
    '-crf', '23',
    '-preset', 'fast',
    '-c:a', 'copy',
    outputName,
  ];
}

export const rotateVideo: ToolModule<RotateVideoParams> = {
  id: 'rotate-video',
  slug: 'rotate-video',
  name: 'Rotate / Flip Video',
  description: 'Rotate a video 90°/180° or mirror it horizontally, vertically, or both.',
  category: 'media',
  keywords: ['video', 'rotate', 'flip', 'mirror', 'orientation', 'transpose', 'turn'],

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
  budget: ROTATE_VIDEO_BUDGET,

  defaults: defaultRotateVideoParams,

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'Transform',
      options: [
        { value: '90cw', label: 'Rotate 90° clockwise' },
        { value: '90ccw', label: 'Rotate 90° counter-clockwise' },
        { value: '180', label: 'Rotate 180°' },
        { value: 'flip-h', label: 'Flip horizontal' },
        { value: 'flip-v', label: 'Flip vertical' },
        { value: 'flip-both', label: 'Flip both axes' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: RotateVideoParams,
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
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, ROTATE_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Rotating' });

    const args = buildRotateArgs(inputName, outputName, params);
    await ff.exec(args);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output);

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
