import type { ToolModule, ToolRunContext } from '../../types.js';

export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov' | 'avi';
export type VideoPreset = 'ultrafast' | 'fast' | 'medium' | 'slow';

export interface ConvertVideoParams {
  format: VideoFormat;
  crf?: number;
  preset?: VideoPreset;
}

export const defaultConvertVideoParams: ConvertVideoParams = {
  format: 'mp4',
  crf: 23,
  preset: 'medium',
};

const FORMAT_MIME: Record<VideoFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
};

export function getVideoMime(format: VideoFormat): string {
  return FORMAT_MIME[format];
}

export const convertVideo: ToolModule<ConvertVideoParams> = {
  id: 'convert-video',
  slug: 'convert-video',
  name: 'Convert Video',
  description: 'Convert video files between MP4, WebM, MKV, MOV, and AVI formats.',
  category: 'media',
  keywords: ['video', 'convert', 'mp4', 'webm', 'mkv', 'mov', 'avi', 'format'],

  input: {
    accept: ['video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'video/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultConvertVideoParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'format',
      options: [
        { value: 'mp4', label: 'MP4' },
        { value: 'webm', label: 'WebM' },
        { value: 'mkv', label: 'MKV' },
        { value: 'mov', label: 'MOV' },
        { value: 'avi', label: 'AVI' },
      ],
    },
    crf: {
      type: 'range',
      label: 'crf',
      min: 0,
      max: 51,
      step: 1,
      help: 'Constant Rate Factor. Higher = smaller file, lower quality.',
    },
    preset: {
      type: 'enum',
      label: 'preset',
      help: 'Encoding speed vs compression tradeoff.',
      options: [
        { value: 'ultrafast', label: 'ultrafast' },
        { value: 'fast', label: 'fast' },
        { value: 'medium', label: 'medium' },
        { value: 'slow', label: 'slow' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: ConvertVideoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = input.name.split('.').pop() ?? 'video';
    const inputName = `input.${ext}`;
    const outputName = `output.${params.format}`;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Converting video' });

    const crf = params.crf ?? 23;
    const preset = params.preset ?? 'medium';

    const args = [
      '-i', inputName,
      '-crf', String(crf),
      '-preset', preset,
      outputName,
    ];

    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getVideoMime(params.format) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['video/mp4'],
  },
};
