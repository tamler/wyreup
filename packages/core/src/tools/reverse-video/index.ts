import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

// Reverse buffers the whole clip in memory, so cap duration tighter than the
// streaming re-encoders.
const REVERSE_VIDEO_BUDGET: ToolBudget = { maxDuration: 1_800 };

export interface ReverseVideoParams {
  reverseAudio?: boolean;
}

export const defaultReverseVideoParams: ReverseVideoParams = {
  reverseAudio: true,
};

/**
 * Play a clip backwards. `reverse` (video) and `areverse` (audio) both buffer
 * the entire stream, which is why the duration budget is tight. When
 * reverseAudio is false the audio is dropped (`-an`) rather than reversed.
 */
export function buildReverseArgs(
  inputName: string,
  outputName: string,
  params: ReverseVideoParams,
): string[] {
  const args = ['-i', inputName, '-vf', 'reverse'];
  if (params.reverseAudio ?? true) {
    args.push('-af', 'areverse');
  } else {
    args.push('-an');
  }
  args.push('-c:v', 'libx264', '-crf', '23', '-preset', 'fast', outputName);
  return args;
}

export const reverseVideo: ToolModule<ReverseVideoParams> = {
  id: 'reverse-video',
  slug: 'reverse-video',
  name: 'Reverse Video',
  description: 'Play a video backwards. Optionally reverse the audio too.',
  category: 'media',
  categories: ['edit'],
  keywords: ['video', 'reverse', 'backwards', 'rewind', 'boomerang', 'flip time'],

  input: { accept: ['video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: REVERSE_VIDEO_BUDGET,

  defaults: defaultReverseVideoParams,

  paramSchema: {
    reverseAudio: { type: 'boolean', label: 'Reverse audio too' },
  },

  async run(inputs: File[], params: ReverseVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
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
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, REVERSE_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reversing' });

    await ff.exec(buildReverseArgs(inputName, outputName, params));
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
