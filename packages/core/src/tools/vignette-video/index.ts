import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const VIGNETTE_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export interface VignetteVideoParams {
  strength: number;
}

export const defaultVignetteVideoParams: VignetteVideoParams = {
  strength: 0.4,
};

/**
 * Darken the frame edges. ffmpeg's `vignette` takes an angle (radians); a
 * larger angle = stronger darkening. We map a 0..1 strength to an angle in
 * (0, PI/2], so 1 is the maximum vignette.
 */
export function buildVignetteArgs(
  inputName: string,
  outputName: string,
  strength: number,
): string[] {
  const s = Math.max(0.05, Math.min(1, strength));
  const angle = (s * Math.PI) / 2;
  return [
    '-i',
    inputName,
    '-vf',
    `vignette=angle=${angle.toFixed(4)}`,
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

export const vignetteVideo: ToolModule<VignetteVideoParams> = {
  id: 'vignette-video',
  slug: 'vignette-video',
  name: 'Vignette',
  description: 'Darken the edges of a video for a classic vignette look. Adjust the strength.',
  category: 'media',
  categories: ['edit'],
  keywords: ['video', 'vignette', 'darken', 'edges', 'effect', 'filter', 'cinematic'],

  input: { accept: ['video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: VIGNETTE_VIDEO_BUDGET,

  defaults: defaultVignetteVideoParams,

  paramSchema: {
    strength: {
      type: 'range',
      label: 'Strength',
      min: 0.05,
      max: 1,
      step: 0.05,
      help: 'Higher = darker edges.',
    },
  },

  async run(inputs: File[], params: VignetteVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
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
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, VIGNETTE_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Applying vignette' });

    await ff.exec(buildVignetteArgs(inputName, outputName, params.strength));
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
