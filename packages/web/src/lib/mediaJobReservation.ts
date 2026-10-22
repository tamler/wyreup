/** One unsettled FFmpeg UI job per page/module realm; no cross-tab or core lock. */
const MEDIA_TOOL_IDS = new Set([
  'analyze-loudness',
  'audio-speed',
  'burn-subtitles',
  'compress-video',
  'convert-audio',
  'convert-video',
  'crop-video',
  'merge-audio',
  'extract-audio',
  'trim-media',
  'video-to-gif',
  'video-concat',
  'video-add-text',
  'video-speed',
  'video-overlay-image',
  'video-crossfade',
  'video-color-correct',
  'resize-video',
  'mute-video',
  'rotate-video',
  'extract-frame',
  'replace-audio',
  'normalize-loudness',
  'video-quality-metrics',
  'reverse-video',
  'video-volume',
  'loop-video',
  'strip-video-metadata',
  'fade-video',
  'vignette-video',
  'letterbox-video',
  'mix-audio',
  'video-side-by-side',
]);

let activeOwner: symbol | null = null;

export function requiresMediaJob(ids: readonly string[]): boolean {
  return ids.some((id) => MEDIA_TOOL_IDS.has(id));
}

export function tryReserveMediaJob(ids: readonly string[]): { release(): void } | null {
  if (!requiresMediaJob(ids)) return { release() {} };
  if (activeOwner !== null) return null;
  const owner = Symbol('media-job');
  activeOwner = owner;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      if (activeOwner === owner) activeOwner = null;
    },
  };
}
