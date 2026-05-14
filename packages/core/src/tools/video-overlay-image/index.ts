import type { ToolModule, ToolRunContext } from '../../types.js';

export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface VideoOverlayImageParams {
  position?: OverlayPosition;
  margin?: number;
  scale?: number;
  opacity?: number;
  startSeconds?: number;
  durationSeconds?: number;
}

export const defaultVideoOverlayImageParams: VideoOverlayImageParams = {
  position: 'bottom-right',
  margin: 20,
  scale: 0.15,
  opacity: 1.0,
  startSeconds: 0,
};

/** Map position + margin to overlay x/y expressions. */
export function overlayPositionToXY(position: OverlayPosition, margin: number): { x: string; y: string } {
  switch (position) {
    case 'top-left':
      return { x: String(margin), y: String(margin) };
    case 'top-right':
      return { x: `W-w-${margin}`, y: String(margin) };
    case 'bottom-left':
      return { x: String(margin), y: `H-h-${margin}` };
    case 'bottom-right':
      return { x: `W-w-${margin}`, y: `H-h-${margin}` };
    case 'center':
      return { x: '(W-w)/2', y: '(H-h)/2' };
    default:
      return { x: `W-w-${margin}`, y: `H-h-${margin}` };
  }
}

export function buildOverlayFilter(params: VideoOverlayImageParams): string {
  const position = params.position ?? 'bottom-right';
  const margin = params.margin ?? 20;
  const scale = params.scale ?? 0.15;
  const opacity = params.opacity ?? 1.0;
  const start = params.startSeconds ?? 0;

  const { x, y } = overlayPositionToXY(position, margin);

  let scaleFilter = `scale=iw*${scale}:ih*${scale}`;
  // When opacity < 1, we need format=rgba and colorchannelmixer for alpha
  if (opacity < 1.0) {
    scaleFilter += `,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}`;
  }

  let enableExpr = '';
  if (params.durationSeconds !== undefined && params.durationSeconds > 0) {
    const end = start + params.durationSeconds;
    enableExpr = `:enable='between(t,${start},${end})'`;
  } else if (start > 0) {
    enableExpr = `:enable='gte(t,${start})'`;
  }

  return `[1:v]${scaleFilter}[ol];[0:v][ol]overlay=${x}:${y}${enableExpr}`;
}

export const videoOverlayImage: ToolModule<VideoOverlayImageParams> = {
  id: 'video-overlay-image',
  slug: 'video-overlay-image',
  name: 'Overlay Image on Video',
  description: 'Add a watermark or logo image over a video at a fixed position.',
  category: 'media',
  keywords: ['video', 'watermark', 'logo', 'overlay', 'brand', 'stamp', 'image'],

  input: {
    accept: ['video/*', 'image/*'],
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

  defaults: defaultVideoOverlayImageParams,

  paramSchema: {
    position: {
      type: 'enum',
      label: 'Position',
      options: [
        { value: 'top-left', label: 'Top left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'center', label: 'Center' },
      ],
    },
    margin: {
      type: 'range',
      label: 'Edge margin',
      min: 0,
      max: 100,
      step: 1,
      unit: 'px',
    },
    scale: {
      type: 'range',
      label: 'Overlay size',
      help: 'Overlay width as a fraction of video width.',
      min: 0.05,
      max: 1.0,
      step: 0.05,
    },
    opacity: {
      type: 'range',
      label: 'Opacity',
      min: 0,
      max: 1,
      step: 0.1,
    },
    startSeconds: {
      type: 'number',
      label: 'Start time',
      min: 0,
      unit: 's',
    },
    durationSeconds: {
      type: 'number',
      label: 'Duration',
      min: 0,
      unit: 's',
      help: 'How long to show the overlay. Leave 0 to show until end.',
    },
  },

  async run(
    inputs: File[],
    params: VideoOverlayImageParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (inputs.length < 2) {
      throw new Error('video-overlay-image requires two files: a video and an image.');
    }

    const videoFile = inputs.find((f) => f.type.startsWith('video/'));
    const imageFile = inputs.find((f) => f.type.startsWith('image/'));

    if (!videoFile || !imageFile) {
      throw new Error('Please provide one video file and one image file.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const videoExt = videoFile.name.split('.').pop() ?? 'mp4';
    const imageExt = imageFile.name.split('.').pop() ?? 'png';
    const videoName = `input.${videoExt}`;
    const imageName = `overlay.${imageExt}`;
    const outputName = 'output.mp4';

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Writing input files' });

    const videoBytes = new Uint8Array(await videoFile.arrayBuffer());
    const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
    await ff.writeFile(videoName, videoBytes);
    await ff.writeFile(imageName, imageBytes);

    if (ctx.signal.aborted) {
      await ff.deleteFile(videoName).catch(() => {});
      await ff.deleteFile(imageName).catch(() => {});
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Compositing overlay' });

    const filterComplex = buildOverlayFilter(params);

    await ff.exec([
      '-i', videoName,
      '-i', imageName,
      '-filter_complex', filterComplex,
      '-c:a', 'copy',
      '-preset', 'fast',
      outputName,
    ]);

    const output = await ff.readFile(outputName);
    const outputBytes: Uint8Array =
      typeof output === 'string' ? new TextEncoder().encode(output) : (output as Uint8Array);

    await ff.deleteFile(videoName).catch(() => {});
    await ff.deleteFile(imageName).catch(() => {});
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
