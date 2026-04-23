import type { ToolModule, ToolRunContext } from '../../types.js';

export interface VideoSpeedParams {
  speed: number;
  preserveAudioPitch?: boolean;
  crf?: number;
}

export const defaultVideoSpeedParams: VideoSpeedParams = {
  speed: 1.0,
  preserveAudioPitch: true,
  crf: 23,
};

/**
 * Build the atempo filter chain for a given speed.
 * atempo only accepts values in [0.5, 100], so for speeds outside that
 * range we chain multiple atempo filters.
 */
export function buildAtempoChain(speed: number): string {
  if (speed >= 0.5 && speed <= 100) {
    return `atempo=${speed}`;
  }

  // For speeds < 0.5, chain multiple 0.5 factors
  // For speeds > 100, chain multiple 100 factors (edge case unlikely in UI)
  const filters: string[] = [];
  let remaining = speed;

  if (speed < 0.5) {
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    if (Math.abs(remaining - 1.0) > 0.001) {
      filters.push(`atempo=${remaining.toFixed(4)}`);
    }
  } else {
    while (remaining > 100) {
      filters.push('atempo=100');
      remaining /= 100;
    }
    if (Math.abs(remaining - 1.0) > 0.001) {
      filters.push(`atempo=${remaining.toFixed(4)}`);
    }
  }

  return filters.join(',');
}

export function buildSpeedArgs(
  inputName: string,
  outputName: string,
  params: VideoSpeedParams,
): string[] {
  const speed = params.speed ?? 1.0;
  const preservePitch = params.preserveAudioPitch ?? true;
  const crf = params.crf ?? 23;

  const videoFilter = `setpts=${(1 / speed).toFixed(6)}*PTS`;
  const audioFilter = preservePitch
    ? buildAtempoChain(speed)
    : `asetrate=44100*${speed},aresample=44100`;

  return [
    '-i', inputName,
    '-filter:v', videoFilter,
    '-filter:a', audioFilter,
    '-crf', String(crf),
    '-preset', 'fast',
    outputName,
  ];
}

const VideoSpeedComponentStub = (): unknown => null;

export const videoSpeed: ToolModule<VideoSpeedParams> = {
  id: 'video-speed',
  slug: 'video-speed',
  name: 'Change Video Speed',
  description: 'Speed up or slow down a video while keeping audio synced.',
  category: 'media',
  presence: 'both',
  keywords: ['video', 'speed', 'slow', 'fast', 'timelapse', 'slowmo', 'playback', 'tempo'],

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

  defaults: defaultVideoSpeedParams,

  paramSchema: {
    speed: {
      type: 'range',
      label: 'Speed multiplier',
      help: '0.5 = half speed (2x duration), 2.0 = double speed (half duration)',
      min: 0.25,
      max: 4.0,
      step: 0.05,
    },
    preserveAudioPitch: {
      type: 'boolean',
      label: 'Preserve audio pitch',
      help: 'When enabled, audio pitch stays natural at the new speed.',
    },
    crf: {
      type: 'range',
      label: 'CRF',
      min: 0,
      max: 51,
      step: 1,
    },
  },

  Component: VideoSpeedComponentStub,

  async run(
    inputs: File[],
    params: VideoSpeedParams,
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

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Adjusting speed' });

    const args = buildSpeedArgs(inputName, outputName, params);
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
