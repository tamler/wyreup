import type { ToolModule, ToolRunContext } from '../../types.js';

export type VideoConcatPreset = 'ultrafast' | 'fast' | 'medium' | 'slow';

export interface VideoConcatParams {
  reencode?: boolean;
  preset?: VideoConcatPreset;
  crf?: number;
}

export const defaultVideoConcatParams: VideoConcatParams = {
  reencode: false,
  preset: 'fast',
  crf: 23,
};

export function buildConcatArgs(
  inputCount: number,
  reencode: boolean,
  preset: VideoConcatPreset,
  crf: number,
): string[] {
  const args = ['-f', 'concat', '-safe', '0', '-i', 'list.txt'];
  if (reencode) {
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-c:a', 'aac');
  } else {
    args.push('-c', 'copy');
  }
  args.push('output.mp4');
  return args;
}

export const videoConcat: ToolModule<VideoConcatParams> = {
  id: 'video-concat',
  slug: 'video-concat',
  name: 'Concatenate Videos',
  description: 'Join multiple video files end-to-end into a single MP4.',
  category: 'media',
  keywords: ['video', 'concat', 'join', 'merge', 'combine', 'append', 'stitch'],

  input: {
    accept: ['video/*'],
    min: 2,
    max: 20,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultVideoConcatParams,

  paramSchema: {
    reencode: {
      type: 'boolean',
      label: 'Re-encode',
      help: 'Force re-encoding. Required if input codecs differ. Slower but always works.',
    },
    preset: {
      type: 'enum',
      label: 'Encode preset',
      help: 'Only used when re-encode is enabled.',
      options: [
        { value: 'ultrafast', label: 'ultrafast' },
        { value: 'fast', label: 'fast' },
        { value: 'medium', label: 'medium' },
        { value: 'slow', label: 'slow' },
      ],
    },
    crf: {
      type: 'range',
      label: 'CRF',
      help: 'Quality factor (only when re-encoding). Lower = better quality, larger file.',
      min: 0,
      max: 51,
      step: 1,
    },
  },

  async run(
    inputs: File[],
    params: VideoConcatParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (inputs.length < 2) {
      throw new Error('video-concat requires at least 2 video files.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing input files' });

    const inputNames: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const file = inputs[i]!;
      const ext = file.name.split('.').pop() ?? 'mp4';
      const name = `input${i}.${ext}`;
      inputNames.push(name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ff.writeFile(name, bytes);
    }

    // Build concat manifest
    const listContent = inputNames.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile('list.txt', new TextEncoder().encode(listContent));

    if (ctx.signal.aborted) {
      for (const n of inputNames) await ff.deleteFile(n).catch(() => {});
      await ff.deleteFile('list.txt').catch(() => {});
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Concatenating videos' });

    const reencode = params.reencode ?? false;
    const preset = params.preset ?? 'fast';
    const crf = params.crf ?? 23;

    const args = buildConcatArgs(inputs.length, reencode, preset, crf);
    await ff.exec(args);

    const output = await ff.readFile('output.mp4');
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output as Uint8Array);

    for (const n of inputNames) await ff.deleteFile(n).catch(() => {});
    await ff.deleteFile('list.txt').catch(() => {});
    await ff.deleteFile('output.mp4').catch(() => {});

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: 'video/mp4' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['video/mp4'],
  },
};
