import type { ToolModule, ToolRunContext } from '../../types.js';

export type TextPosition =
  | 'top'
  | 'center'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface VideoAddTextParams {
  text: string;
  position?: TextPosition;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  startSeconds?: number;
  durationSeconds?: number;
  crf?: number;
}

export const defaultVideoAddTextParams: VideoAddTextParams = {
  text: '',
  position: 'bottom',
  fontSize: 32,
  fontColor: '#FFFFFF',
  backgroundOpacity: 0.5,
  startSeconds: 0,
  crf: 23,
};

/** Map position enum to drawtext x/y expressions. */
export function positionToXY(position: TextPosition): { x: string; y: string } {
  switch (position) {
    case 'top':
      return { x: '(w-text_w)/2', y: '20' };
    case 'center':
      return { x: '(w-text_w)/2', y: '(h-text_h)/2' };
    case 'bottom':
      return { x: '(w-text_w)/2', y: 'h-text_h-20' };
    case 'top-left':
      return { x: '20', y: '20' };
    case 'top-right':
      return { x: 'w-text_w-20', y: '20' };
    case 'bottom-left':
      return { x: '20', y: 'h-text_h-20' };
    case 'bottom-right':
      return { x: 'w-text_w-20', y: 'h-text_h-20' };
    default:
      return { x: '(w-text_w)/2', y: 'h-text_h-20' };
  }
}

/**
 * Escape text for use inside ffmpeg drawtext filter value.
 * Backslashes must be escaped first, then single quotes, then colons.
 */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:');
}

/** Convert CSS hex color (#RRGGBB or #RGB) to ffmpeg color notation (0xRRGGBB). */
export function hexToFfmpegColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const [r, g, b] = clean.split('');
    return `0x${r}${r}${g}${g}${b}${b}`;
  }
  return `0x${clean}`;
}

export function buildDrawtextFilter(params: VideoAddTextParams): string {
  const position = params.position ?? 'bottom';
  const fontSize = params.fontSize ?? 32;
  const fontColor = params.fontColor ?? '#FFFFFF';
  const startSeconds = params.startSeconds ?? 0;

  const { x, y } = positionToXY(position);
  const escapedText = escapeDrawtext(params.text);
  const color = hexToFfmpegColor(fontColor);

  let filter = `drawtext=text='${escapedText}':x=${x}:y=${y}:fontsize=${fontSize}:fontcolor=${color}`;

  if (params.backgroundColor) {
    const bgColor = hexToFfmpegColor(params.backgroundColor);
    const opacity = params.backgroundOpacity ?? 0.5;
    // ffmpeg expects box=1:boxcolor=COLOR@OPACITY
    filter += `:box=1:boxcolor=${bgColor}@${opacity}`;
  }

  // Time gating
  const enableParts: string[] = [];
  if (params.durationSeconds !== undefined && params.durationSeconds > 0) {
    const end = startSeconds + params.durationSeconds;
    enableParts.push(`between(t\\,${startSeconds}\\,${end})`);
  } else if (startSeconds > 0) {
    enableParts.push(`gte(t\\,${startSeconds})`);
  }

  if (enableParts.length > 0) {
    filter += `:enable='${enableParts.join('+')}'`;
  }

  return filter;
}

export const videoAddText: ToolModule<VideoAddTextParams> = {
  id: 'video-add-text',
  slug: 'video-add-text',
  name: 'Add Text to Video',
  description: 'Overlay text on a video at a chosen position, size, and color.',
  category: 'media',
  keywords: ['video', 'text', 'caption', 'title', 'overlay', 'watermark', 'subtitle', 'label'],

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

  defaults: defaultVideoAddTextParams,

  paramSchema: {
    text: {
      type: 'string',
      label: 'Text',
      placeholder: 'Enter text to overlay',
      maxLength: 500,
    },
    position: {
      type: 'enum',
      label: 'Position',
      options: [
        { value: 'top', label: 'Top center' },
        { value: 'center', label: 'Center' },
        { value: 'bottom', label: 'Bottom center' },
        { value: 'top-left', label: 'Top left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-right', label: 'Bottom right' },
      ],
    },
    fontSize: {
      type: 'range',
      label: 'Font size',
      min: 12,
      max: 96,
      step: 1,
      unit: 'px',
    },
    fontColor: {
      type: 'string',
      label: 'Font color',
      placeholder: '#FFFFFF',
    },
    backgroundColor: {
      type: 'string',
      label: 'Background color',
      placeholder: '#000000 (leave empty for none)',
    },
    backgroundOpacity: {
      type: 'range',
      label: 'Background opacity',
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
      help: 'How long to show the text. Leave 0 to show until end.',
    },
    crf: {
      type: 'range',
      label: 'CRF',
      min: 0,
      max: 51,
      step: 1,
    },
  },

  async run(
    inputs: File[],
    params: VideoAddTextParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg } = await import('../../lib/ffmpeg.js');

    if (!params.text || params.text.trim() === '') {
      throw new Error('text is required.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const ext = input.name.split('.').pop() ?? 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    await ff.writeFile(inputName, inputBytes);

    if (ctx.signal.aborted) {
      await ff.deleteFile(inputName).catch(() => {});
      throw new Error('Aborted');
    }

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Rendering text' });

    const vfFilter = buildDrawtextFilter(params);
    const crf = params.crf ?? 23;

    await ff.exec([
      '-i', inputName,
      '-vf', vfFilter,
      '-crf', String(crf),
      '-preset', 'fast',
      '-c:a', 'copy',
      outputName,
    ]);

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
