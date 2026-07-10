import type { ToolModule, ToolRunContext } from '../../types.js';

export type FrameFormat = 'png' | 'jpeg';

export interface ExtractFrameParams {
  timestamp?: number;
  format?: FrameFormat;
}

export const defaultExtractFrameParams: ExtractFrameParams = {
  timestamp: 0,
  format: 'png',
};

const FRAME_MIME: Record<FrameFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

const FRAME_EXT: Record<FrameFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
};

export function getFrameMime(format: FrameFormat): string {
  return FRAME_MIME[format];
}

export function getFrameExt(format: FrameFormat): string {
  return FRAME_EXT[format];
}

/**
 * Grab a single frame at `timestamp` seconds. `-ss` before `-i` performs a
 * fast input seek; `-vframes 1` writes exactly one image.
 */
export function buildExtractFrameArgs(
  inputName: string,
  outputName: string,
  params: ExtractFrameParams,
): string[] {
  const ts = Math.max(0, params.timestamp ?? 0);
  return ['-ss', String(ts), '-i', inputName, '-vframes', '1', outputName];
}

export const extractFrame: ToolModule<ExtractFrameParams> = {
  id: 'extract-frame',
  slug: 'extract-frame',
  name: 'Extract Frame',
  description: 'Capture a single frame from a video at a given time as a PNG or JPEG image.',
  category: 'media',
  keywords: ['video', 'frame', 'thumbnail', 'screenshot', 'snapshot', 'still', 'poster', 'image'],

  input: {
    accept: ['video/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'image/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultExtractFrameParams,

  paramSchema: {
    timestamp: {
      type: 'number',
      label: 'Timestamp (seconds)',
      help: 'Time in the video to capture the frame from.',
    },
    format: {
      type: 'enum',
      label: 'Format',
      options: [
        { value: 'png', label: 'PNG (lossless)' },
        { value: 'jpeg', label: 'JPEG (smaller)' },
      ],
    },
  },

  async run(inputs: File[], params: ExtractFrameParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const format = params.format ?? 'png';
    const inExt = input.name.split('.').pop() ?? 'mp4';
    const inputName = `input.${inExt}`;
    const outputName = `output.${getFrameExt(format)}`;

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    await ff.writeFile(inputName, inputBytes);

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Extracting frame' });

    const args = buildExtractFrameArgs(inputName, outputName, params);
    await ff.exec(args);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : output;

    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getFrameMime(format) })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};
