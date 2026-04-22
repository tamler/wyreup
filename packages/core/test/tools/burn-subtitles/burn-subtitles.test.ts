/**
 * burn-subtitles tests
 *
 * 1. Metadata — always run.
 * 2. run() param validation (no ffmpeg needed) — always run.
 * 3. Full run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import { burnSubtitles, defaultBurnSubtitlesParams } from '../../../src/tools/burn-subtitles/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('burn-subtitles — metadata', () => {
  it('has id "burn-subtitles"', () => expect(burnSubtitles.id).toBe('burn-subtitles'));
  it('category is "media"', () => expect(burnSubtitles.category).toBe('media'));
  it('input min is 2', () => expect(burnSubtitles.input.min).toBe(2));
  it('input max is 2', () => expect(burnSubtitles.input.max).toBe(2));
  it('output is video/mp4', () => expect(burnSubtitles.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(burnSubtitles.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(burnSubtitles.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(burnSubtitles.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(burnSubtitles.cost).toBe('free'));
  it('batchable is false', () => expect(burnSubtitles.batchable).toBe(false));
  it('defaults fontSize is 16', () => expect(defaultBurnSubtitlesParams.fontSize).toBe(16));
  it('defaults crf is 23', () => expect(defaultBurnSubtitlesParams.crf).toBe(23));
});

describe('burn-subtitles — run() param validation', () => {
  it('throws when fewer than 2 inputs', async () => {
    const file = new File(['data'], 'video.mp4', { type: 'video/mp4' });
    await expect(
      burnSubtitles.run([file], { fontSize: 16, crf: 23 }, makeCtx()),
    ).rejects.toThrow(/two files/i);
  });

  it('throws when no video file provided', async () => {
    const sub1 = new File(['WEBVTT\n\n'], 'a.vtt', { type: 'text/vtt' });
    const sub2 = new File(['WEBVTT\n\n'], 'b.vtt', { type: 'text/vtt' });
    await expect(
      burnSubtitles.run([sub1, sub2], { fontSize: 16, crf: 23 }, makeCtx()),
    ).rejects.toThrow(/video file/i);
  });
});

// Full run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
