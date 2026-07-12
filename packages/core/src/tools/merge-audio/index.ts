import type { ToolModule, ToolRunContext } from '../../types.js';
import { defaultMergeAudioParams, type MergeAudioFormat, type MergeAudioParams } from './types.js';

export { defaultMergeAudioParams } from './types.js';
export type { MergeAudioFormat, MergeAudioParams } from './types.js';

const FORMAT_CODEC: Record<MergeAudioFormat, string> = {
  mp3: 'libmp3lame',
  wav: 'pcm_s16le',
  m4a: 'aac',
};

const FORMAT_MIME: Record<MergeAudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

export function buildMergeAudioArgs(inputCount: number, format: MergeAudioFormat): string[] {
  if (!Number.isInteger(inputCount) || inputCount < 2) {
    throw new Error('merge-audio requires at least 2 audio inputs.');
  }

  const args: string[] = [];
  for (let i = 0; i < inputCount; i++) {
    args.push('-i', `input${i}`);
  }

  args.push(
    '-filter_complex',
    `concat=n=${inputCount}:v=0:a=1[out]`,
    '-map',
    '[out]',
    '-c:a',
    FORMAT_CODEC[format],
    `output.${format}`,
  );
  return args;
}

export const mergeAudio: ToolModule<MergeAudioParams> = {
  id: 'merge-audio',
  slug: 'merge-audio',
  name: 'Merge Audio',
  description:
    'Join two or more audio files in input order. Mixed formats are supported because every input is re-encoded into one MP3, WAV, or M4A track.',
  llmDescription:
    'Join two or more audio files end-to-end in input order, including mixed input formats. The tool always re-encodes and returns one MP3, WAV, or M4A file.',
  category: 'audio',
  categories: ['audio', 'media'],
  keywords: [
    'audio',
    'merge',
    'join',
    'concat',
    'combine',
    'append',
    'stitch',
    'mp3',
    'wav',
    'm4a',
  ],

  input: {
    accept: ['audio/*'],
    min: 2,
    max: 20,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'audio/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultMergeAudioParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'Output format',
      help: 'Choose MP3, WAV, or M4A. All inputs are re-encoded into this format.',
      options: [
        { value: 'mp3', label: 'MP3' },
        { value: 'wav', label: 'WAV' },
        { value: 'm4a', label: 'M4A' },
      ],
    },
  },

  async run(inputs: File[], params: MergeAudioParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (inputs.length < 2) {
      throw new Error('merge-audio requires at least 2 audio files.');
    }

    const format = params.format ?? defaultMergeAudioParams.format;
    if (!(format in FORMAT_CODEC)) {
      throw new Error(`Unsupported output format: ${String(format)}`);
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing input files' });

    const inputNames: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const inputName = `input${i}`;
      inputNames.push(inputName);
      await ff.writeFile(inputName, new Uint8Array(await inputs[i]!.arrayBuffer()));
    }

    if (ctx.signal.aborted) {
      for (const inputName of inputNames) await ff.deleteFile(inputName).catch(() => {});
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Merging audio' });

    const outputName = `output.${format}`;
    await ff.exec(buildMergeAudioArgs(inputs.length, format));
    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : output;

    for (const inputName of inputNames) await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: FORMAT_MIME[format] })];
  },

  __testFixtures: {
    valid: ['tone-16k.wav', 'tone-16k.wav'],
    weird: [],
    expectedOutputMime: ['audio/mpeg'],
  },
};
