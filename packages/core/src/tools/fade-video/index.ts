import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

const FADE_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export interface FadeVideoParams {
  fadeIn: number;
  fadeOut: number;
}

export const defaultFadeVideoParams: FadeVideoParams = {
  fadeIn: 1,
  fadeOut: 1,
};

/**
 * Build fade filters given the clip duration. Video uses `fade`, audio uses
 * `afade`; the fade-out start is `duration - fadeOut`. At least one of fadeIn
 * or fadeOut must be > 0. Returns the `-vf` and `-af` filter strings.
 */
export function buildFadeFilters(
  params: FadeVideoParams,
  durationSec: number,
): { video: string; audio: string } {
  const fadeIn = Math.max(0, params.fadeIn ?? 0);
  const fadeOut = Math.max(0, params.fadeOut ?? 0);
  if (fadeIn === 0 && fadeOut === 0) {
    throw new Error('Set a fade-in or fade-out duration greater than 0');
  }
  const vid: string[] = [];
  const aud: string[] = [];
  if (fadeIn > 0) {
    vid.push(`fade=t=in:st=0:d=${fadeIn}`);
    aud.push(`afade=t=in:st=0:d=${fadeIn}`);
  }
  if (fadeOut > 0 && isFinite(durationSec) && durationSec > fadeOut) {
    const start = (durationSec - fadeOut).toFixed(3);
    vid.push(`fade=t=out:st=${start}:d=${fadeOut}`);
    aud.push(`afade=t=out:st=${start}:d=${fadeOut}`);
  }
  return { video: vid.join(','), audio: aud.join(',') };
}

export function buildFadeArgs(
  inputName: string,
  outputName: string,
  params: FadeVideoParams,
  durationSec: number,
): string[] {
  const { video, audio } = buildFadeFilters(params, durationSec);
  const args = ['-i', inputName, '-vf', video];
  if (audio) args.push('-af', audio);
  args.push('-c:v', 'libx264', '-crf', '23', '-preset', 'fast', outputName);
  return args;
}

export const fadeVideo: ToolModule<FadeVideoParams> = {
  id: 'fade-video',
  slug: 'fade-video',
  name: 'Fade In / Out',
  description:
    'Add a fade-in from black at the start and/or a fade-out to black at the end (video and audio).',
  category: 'media',
  categories: ['edit'],
  keywords: ['video', 'fade', 'fade in', 'fade out', 'intro', 'outro', 'transition', 'dissolve'],

  input: { accept: ['video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',
  budget: FADE_VIDEO_BUDGET,

  defaults: defaultFadeVideoParams,

  paramSchema: {
    fadeIn: { type: 'number', label: 'Fade-in (seconds)' },
    fadeOut: { type: 'number', label: 'Fade-out (seconds)' },
  },

  async run(inputs: File[], params: FadeVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
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
    if (!isNaN(durationSec)) assertDurationBudget(durationSec, FADE_VIDEO_BUDGET);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Applying fade' });

    await ff.exec(buildFadeArgs(inputName, outputName, params, durationSec));
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
