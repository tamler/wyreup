import type { ToolModule, ToolRunContext } from '../../types.js';

export interface TrimMediaParams {
  start: number;
  end: number;
  stream_copy?: boolean;
}

export const defaultTrimMediaParams: TrimMediaParams = {
  start: 0,
  end: 30,
  stream_copy: false,
};

function getMimeFromFile(file: File): string {
  return file.type || 'application/octet-stream';
}

function getExtFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'bin') : 'bin';
}

const TrimMediaComponentStub = (): unknown => null;

export const trimMedia: ToolModule<TrimMediaParams> = {
  id: 'trim-media',
  slug: 'trim-media',
  name: 'Trim Media',
  description: 'Trim an audio or video file to a specific start and end time (in seconds).',
  category: 'media',
  presence: 'both',
  keywords: ['trim', 'cut', 'clip', 'audio', 'video', 'start', 'end', 'duration'],

  input: {
    accept: ['audio/*', 'video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: '*/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultTrimMediaParams,

  Component: TrimMediaComponentStub,

  async run(
    inputs: File[],
    params: TrimMediaParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    if (params.start < 0) throw new Error('start must be >= 0');
    if (params.end <= params.start) throw new Error('end must be greater than start');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = getExtFromFile(input);
    const inputName = `input.${ext}`;
    const outputName = `output.${ext}`;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Trimming' });

    const duration = params.end - params.start;
    const args = [
      '-ss', String(params.start),
      '-i', inputName,
      '-t', String(duration),
    ];

    if (params.stream_copy) {
      args.push('-c', 'copy');
    }

    args.push(outputName);

    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getMimeFromFile(input) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['audio/mpeg'],
  },
};
