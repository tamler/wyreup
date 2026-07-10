import type { ToolBudget, ToolModule, ToolRunContext } from '../../types.js';
import { assertDurationBudget } from '../../lib/budget.js';

export interface CompressVideoParams {
  crf?: number;
  preset?: string;
}

export const defaultCompressVideoParams: CompressVideoParams = {
  crf: 28,
  preset: 'fast',
};

const COMPRESS_VIDEO_BUDGET: ToolBudget = { maxDuration: 7_200 };

export const compressVideo: ToolModule<CompressVideoParams> = {
  id: 'compress-video',
  slug: 'compress-video',
  name: 'Compress Video',
  description:
    'Reduce video file size using H.264 encoding. Higher CRF = smaller file, lower quality.',
  category: 'media',
  keywords: ['video', 'compress', 'reduce', 'size', 'h264', 'mp4', 'crf'],

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
  budget: COMPRESS_VIDEO_BUDGET,

  defaults: defaultCompressVideoParams,

  paramSchema: {
    crf: {
      type: 'range',
      label: 'crf',
      min: 0,
      max: 51,
      step: 1,
      help: 'Constant Rate Factor. Higher = smaller file, lower quality. 28 is a good default.',
    },
    preset: {
      type: 'enum',
      label: 'preset',
      help: 'Encoding speed. Slower presets compress better but take longer.',
      options: [
        { value: 'ultrafast', label: 'ultrafast' },
        { value: 'fast', label: 'fast' },
        { value: 'medium', label: 'medium' },
        { value: 'slow', label: 'slow' },
      ],
    },
  },

  async run(inputs: File[], params: CompressVideoParams, ctx: ToolRunContext): Promise<Blob[]> {
    const { getFFmpeg, probeDuration } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = input.name.split('.').pop() ?? 'video';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    // Write once, probe duration, then transform.
    await ff.writeFile(inputName, inputBytes);
    const durationSec = await probeDuration(ff, inputName);
    if (!isNaN(durationSec)) {
      assertDurationBudget(durationSec, COMPRESS_VIDEO_BUDGET);
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Compressing video' });

    const crf = params.crf ?? 28;
    const preset = params.preset ?? 'fast';

    const args = [
      '-i',
      inputName,
      '-vcodec',
      'libx264',
      '-crf',
      String(crf),
      '-preset',
      preset,
      '-acodec',
      'copy',
      outputName,
    ];

    await ff.exec(args);
    const output = await ff.readFile(outputName);
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
    const outputBytes = typeof output === 'string' ? new TextEncoder().encode(output) : output;

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['video/mp4'],
  },
};
