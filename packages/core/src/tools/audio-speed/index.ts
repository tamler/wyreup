import type { ToolModule, ToolRunContext } from '../../types.js';
import { defaultAudioSpeedParams, type AudioSpeedParams } from './types.js';

export { defaultAudioSpeedParams } from './types.js';
export type { AudioSpeedParams } from './types.js';

function assertValidSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error('speed must be between 0.25 and 4.');
  }
}

export function decomposeTempo(speed: number): number[] {
  assertValidSpeed(speed);

  const stages: number[] = [];
  let remaining = speed;

  while (remaining > 2) {
    stages.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    stages.push(0.5);
    remaining /= 0.5;
  }

  if (stages.length === 0 || Math.abs(remaining - 1) > Number.EPSILON) {
    stages.push(Number(remaining.toFixed(10)));
  }
  return stages;
}

export function buildAudioSpeedArgs(speed: number, preservePitch: boolean): string[] {
  assertValidSpeed(speed);

  const filter = preservePitch
    ? decomposeTempo(speed)
        .map((stage) => `atempo=${stage}`)
        .join(',')
    : `asetrate=44100*${speed},aresample=44100`;

  return ['-i', 'input', '-filter:a', filter, '-c:a', 'libmp3lame', 'output.mp3'];
}

export const audioSpeed: ToolModule<AudioSpeedParams> = {
  id: 'audio-speed',
  slug: 'audio-speed',
  name: 'Change Audio Speed',
  description:
    'Speed up or slow down one audio file. Preserve pitch for natural voices, or shift pitch with speed for a tape-style effect. Output is MP3.',
  llmDescription:
    'Change one audio file to 0.25x-4x speed and return MP3. preservePitch=true changes tempo while keeping voices natural; false changes tempo and pitch together like tape playback.',
  category: 'audio',
  categories: ['audio', 'media'],
  keywords: [
    'audio',
    'speed',
    'tempo',
    'pitch',
    'slow',
    'fast',
    'playback',
    'voice',
    'tape',
    'mp3',
  ],

  input: {
    accept: ['audio/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'audio/mpeg' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultAudioSpeedParams,

  paramSchema: {
    speed: {
      type: 'range',
      label: 'Speed multiplier',
      help: '1 keeps the original duration; 0.5 is half speed and 2 is double speed.',
      min: 0.25,
      max: 4,
      step: 0.05,
    },
    preservePitch: {
      type: 'boolean',
      label: 'Preserve pitch',
      help: 'Keep voices natural. Disable to shift pitch with speed like tape playback.',
    },
  },

  async run(inputs: File[], params: AudioSpeedParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (inputs.length !== 1) {
      throw new Error('audio-speed requires exactly one audio file.');
    }

    const speed = params.speed ?? defaultAudioSpeedParams.speed;
    const preservePitch = params.preservePitch ?? defaultAudioSpeedParams.preservePitch;
    assertValidSpeed(speed);

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing input file' });
    const inputName = 'input';
    const outputName = 'output.mp3';
    await ff.writeFile(inputName, new Uint8Array(await inputs[0]!.arrayBuffer()));

    if (ctx.signal.aborted) {
      await ff.deleteFile(inputName).catch(() => {});
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Changing audio speed' });
    await ff.exec(buildAudioSpeedArgs(speed, preservePitch));

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : output;

    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'audio/mpeg' })];
  },

  __testFixtures: {
    valid: ['tone-16k.wav'],
    weird: [],
    expectedOutputMime: ['audio/mpeg'],
  },
};
