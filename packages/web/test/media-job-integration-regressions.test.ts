import { expect, it } from 'vitest';
import { requiresMediaJob, tryReserveMediaJob } from '../src/lib/mediaJobReservation';

const expectedOwners = [
  'analyze-loudness', 'audio-speed', 'burn-subtitles', 'compress-video', 'convert-audio',
  'convert-video', 'crop-video', 'merge-audio', 'extract-audio', 'trim-media', 'video-to-gif',
  'video-concat', 'video-add-text', 'video-speed', 'video-overlay-image', 'video-crossfade',
  'video-color-correct', 'resize-video', 'mute-video', 'rotate-video', 'extract-frame',
  'replace-audio', 'normalize-loudness', 'video-quality-metrics', 'reverse-video',
  'video-volume', 'loop-video', 'strip-video-metadata', 'fade-video', 'vignette-video',
  'letterbox-video', 'mix-audio', 'video-side-by-side',
];

it('recognizes every actual backend owner, including mixed chains, without substring guesses', () => {
  expect(expectedOwners).toHaveLength(33);
  for (const id of expectedOwners) expect(requiresMediaJob([id]), id).toBe(true);
  expect(requiresMediaJob(['hash', 'video-concat'])).toBe(true);
  for (const id of ['hash', 'audio-enhance', 'compress', 'video-concat-custom', 'mp3-to-midi'])
    expect(requiresMediaJob([id]), id).toBe(false);
});

it('admits one owner synchronously and an unrelated release cannot free it', () => {
  const first = tryReserveMediaJob(['video-concat']);
  expect(first).not.toBeNull();
  try {
    expect(tryReserveMediaJob(['compress-video'])).toBeNull();
    const local = tryReserveMediaJob(['hash']);
    expect(local).not.toBeNull();
    local?.release();
    expect(tryReserveMediaJob(['trim-media'])).toBeNull();
  } finally {
    first?.release();
  }
  const second = tryReserveMediaJob(['trim-media']);
  expect(second).not.toBeNull();
  first?.release();
  expect(tryReserveMediaJob(['analyze-loudness'])).toBeNull();
  second?.release();
});

it('keeps unsettled native work reserved after UI cancellation until its promise settles', async () => {
  let settle!: () => void;
  const native = new Promise<void>((resolve) => { settle = resolve; });
  const controller = new AbortController();
  const lease = tryReserveMediaJob(['convert-video']);
  expect(lease).not.toBeNull();
  const task = native.finally(() => lease?.release());
  controller.abort();
  expect(controller.signal.aborted).toBe(true);
  expect(tryReserveMediaJob(['mix-audio'])).toBeNull();
  settle();
  await task;
  const next = tryReserveMediaJob(['mix-audio']);
  expect(next).not.toBeNull();
  next?.release();
});
