import type { ToolModule, ToolRunContext } from '../../types.js';

export type CrossfadeTransition =
  | 'fade'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'
  | 'circleopen'
  | 'circleclose';

export interface VideoCrossfadeParams {
  fadeDuration?: number;
  transition?: CrossfadeTransition;
  offsetSeconds?: number;
  crf?: number;
}

export const defaultVideoCrossfadeParams: VideoCrossfadeParams = {
  fadeDuration: 1.0,
  transition: 'fade',
  crf: 23,
};

/**
 * Parse duration in seconds from ffmpeg stderr output.
 * ffmpeg writes lines like: "  Duration: 00:00:10.53, start: ..."
 * Returns 0 if not found.
 */
export function parseDurationFromStderr(stderr: string): number {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!match) return 0;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseFloat(match[3]!);
  return hours * 3600 + minutes * 60 + seconds;
}

export function buildCrossfadeArgs(
  input1Name: string,
  input2Name: string,
  outputName: string,
  fadeDuration: number,
  transition: CrossfadeTransition,
  offset: number,
  crf: number,
): string[] {
  return [
    '-i', input1Name,
    '-i', input2Name,
    '-filter_complex',
    `[0:v][1:v]xfade=transition=${transition}:duration=${fadeDuration}:offset=${offset}[outv];` +
    `[0:a][1:a]acrossfade=d=${fadeDuration}[outa]`,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', String(crf),
    outputName,
  ];
}

const VideoCrossfadeComponentStub = (): unknown => null;

export const videoCrossfade: ToolModule<VideoCrossfadeParams> = {
  id: 'video-crossfade',
  slug: 'video-crossfade',
  name: 'Video Crossfade',
  description: 'Crossfade between two videos with a configurable transition effect.',
  category: 'media',
  presence: 'both',
  keywords: ['video', 'crossfade', 'transition', 'blend', 'wipe', 'dissolve', 'fade'],

  input: {
    accept: ['video/*'],
    min: 2,
    max: 2,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'video/mp4' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultVideoCrossfadeParams,

  paramSchema: {
    fadeDuration: {
      type: 'range',
      label: 'Crossfade duration',
      min: 0.1,
      max: 5.0,
      step: 0.1,
      unit: 's',
    },
    transition: {
      type: 'enum',
      label: 'Transition type',
      options: [
        { value: 'fade', label: 'Fade' },
        { value: 'wipeleft', label: 'Wipe left' },
        { value: 'wiperight', label: 'Wipe right' },
        { value: 'slideleft', label: 'Slide left' },
        { value: 'slideright', label: 'Slide right' },
        { value: 'circleopen', label: 'Circle open' },
        { value: 'circleclose', label: 'Circle close' },
      ],
    },
    offsetSeconds: {
      type: 'number',
      label: 'Crossfade start (offset)',
      min: 0,
      unit: 's',
      help: 'When crossfade begins (seconds from start of first video). Defaults to first video duration minus fade duration.',
    },
    crf: {
      type: 'range',
      label: 'CRF',
      min: 0,
      max: 51,
      step: 1,
    },
  },

  Component: VideoCrossfadeComponentStub,

  async run(
    inputs: File[],
    params: VideoCrossfadeParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (inputs.length !== 2) {
      throw new Error('video-crossfade requires exactly 2 video files.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const [file1, file2] = inputs as [File, File];
    const ext1 = file1.name.split('.').pop() ?? 'mp4';
    const ext2 = file2.name.split('.').pop() ?? 'mp4';
    const input1Name = `input1.${ext1}`;
    const input2Name = `input2.${ext2}`;
    const outputName = 'output.mp4';

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing input files' });

    const bytes1 = new Uint8Array(await file1.arrayBuffer());
    const bytes2 = new Uint8Array(await file2.arrayBuffer());
    await ff.writeFile(input1Name, bytes1);
    await ff.writeFile(input2Name, bytes2);

    if (ctx.signal.aborted) {
      await ff.deleteFile(input1Name).catch(() => {});
      await ff.deleteFile(input2Name).catch(() => {});
      throw new Error('Aborted');
    }

    const fadeDuration = params.fadeDuration ?? 1.0;
    const transition = params.transition ?? 'fade';
    const crf = params.crf ?? 23;

    // Determine offset: parse duration of first video from ffmpeg stderr, or use provided offset
    let offset = params.offsetSeconds;
    if (offset === undefined || offset === null) {
      // Run ffmpeg -i on input1 to get duration (ffmpeg writes to stderr even on error)
      ctx.onProgress({ stage: 'processing', percent: 20, message: 'Detecting video duration' });

      // Capture stderr by temporarily hooking ff.setLogger — store lines in array
      const logLines: string[] = [];
      ff.on('log', ({ message }: { message: string }) => { logLines.push(message); });

      // Intentional: exec with no output to force ffmpeg to print info
      await ff.exec(['-i', input1Name]).catch(() => {});

      const stderrText = logLines.join('\n');
      const duration = parseDurationFromStderr(stderrText);

      // Clean up listener by re-registering nothing (ffmpeg.wasm uses last registered)
      ff.on('log', () => {});

      offset = duration > fadeDuration ? duration - fadeDuration : 0;
    }

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Rendering crossfade' });

    const args = buildCrossfadeArgs(
      input1Name,
      input2Name,
      outputName,
      fadeDuration,
      transition,
      offset,
      crf,
    );

    await ff.exec(args);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output as Uint8Array);

    await ff.deleteFile(input1Name).catch(() => {});
    await ff.deleteFile(input2Name).catch(() => {});
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
