import type { ToolModule, ToolRunContext } from '../../types.js';

// No parameters — it removes all container/stream metadata wholesale.
export type StripVideoMetadataParams = Record<string, never>;

export const defaultStripVideoMetadataParams: StripVideoMetadataParams = {};

function getMimeFromFile(file: File): string {
  return file.type || 'application/octet-stream';
}

function getExtFromFile(file: File): string {
  const parts = file.name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? 'bin') : 'bin';
}

/**
 * Strip container-level metadata (title, comment, GPS/location, creation
 * time, chapter tags) while stream-copying both streams — `-map_metadata -1`
 * drops the global metadata, `-c copy` keeps the media bit-for-bit.
 * Per-stream tags (handler/encoder names) survive; a true all-stream strip
 * needs `-map_metadata:s:<type> -1` per stream and runtime verification —
 * tracked in the tool-review backlog.
 */
export function buildStripMetadataArgs(inputName: string, outputName: string): string[] {
  return ['-i', inputName, '-map_metadata', '-1', '-c', 'copy', outputName];
}

export const stripVideoMetadata: ToolModule<StripVideoMetadataParams> = {
  id: 'strip-video-metadata',
  slug: 'strip-video-metadata',
  name: 'Strip Video Metadata',
  description:
    'Remove container metadata (location, device, creation date, tags) from a video or audio file. Per-stream tags like encoder names may remain. No re-encode.',
  category: 'media',
  categories: ['privacy', 'audio'],
  keywords: [
    'video',
    'audio',
    'metadata',
    'strip',
    'remove',
    'privacy',
    'gps',
    'location',
    'exif',
    'tags',
  ],

  input: { accept: ['audio/*', 'video/*'], min: 1, max: 1, sizeLimit: 500 * 1024 * 1024 },
  output: { mime: '*/*' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  installSize: 30_000_000,
  installGroup: 'ffmpeg',

  defaults: defaultStripVideoMetadataParams,

  async run(
    inputs: File[],
    _params: StripVideoMetadataParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { getFFmpeg, runFFmpeg } = await import('../../lib/ffmpeg.js');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading ffmpeg' });
    const ff = await getFFmpeg(ctx);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const input = inputs[0]!;
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const ext = getExtFromFile(input);
    const inputName = `input.${ext}`;
    const outputName = `output.${ext}`;

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Stripping metadata' });

    const args = buildStripMetadataArgs(inputName, outputName);
    const outputBytes = await runFFmpeg(ff, inputName, inputBytes, outputName, args);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([outputBytes.buffer as ArrayBuffer], { type: getMimeFromFile(input) })];
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['video/mp4'] },
};
