/**
 * video-to-gif tests
 *
 * 1. Metadata — always run.
 * 2. buildGifArgs — pure function, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoToGif,
  defaultVideoToGifParams,
  buildGifArgs,
} from '../../../src/tools/video-to-gif/index.js';

describe('video-to-gif — metadata', () => {
  it('has id "video-to-gif"', () => expect(videoToGif.id).toBe('video-to-gif'));
  it('category is "media"', () => expect(videoToGif.category).toBe('media'));
  it('accepts video/*', () => expect(videoToGif.input.accept).toContain('video/*'));
  it('output mime is image/gif', () => expect(videoToGif.output.mime).toBe('image/gif'));
  it('installSize is 30 MB', () => expect(videoToGif.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoToGif.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoToGif.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoToGif.cost).toBe('free'));
  it('batchable is false', () => expect(videoToGif.batchable).toBe(false));
  it('defaults fps is 15', () => expect(defaultVideoToGifParams.fps).toBe(15));
  it('defaults width is 480', () => expect(defaultVideoToGifParams.width).toBe(480));
  it('defaults startSeconds is 0', () => expect(defaultVideoToGifParams.startSeconds).toBe(0));
  it('defaults durationSeconds is 5', () => expect(defaultVideoToGifParams.durationSeconds).toBe(5));
});

describe('video-to-gif — buildGifArgs()', () => {
  it('includes -ss for start time', () => {
    const args = buildGifArgs('in.mp4', 'out.gif', { startSeconds: 3 });
    expect(args).toContain('-ss');
    expect(args).toContain('3');
  });

  it('includes -t for duration', () => {
    const args = buildGifArgs('in.mp4', 'out.gif', { durationSeconds: 10 });
    expect(args).toContain('-t');
    expect(args).toContain('10');
  });

  it('vf filter includes fps and scale', () => {
    const args = buildGifArgs('in.mp4', 'out.gif', { fps: 10, width: 320 });
    const vfArg = args[args.indexOf('-vf') + 1];
    expect(vfArg).toContain('fps=10');
    expect(vfArg).toContain('scale=320');
  });

  it('includes palettegen for quality', () => {
    const args = buildGifArgs('in.mp4', 'out.gif', {});
    const vfArg = args[args.indexOf('-vf') + 1];
    expect(vfArg).toContain('palettegen');
    expect(vfArg).toContain('paletteuse');
  });

  it('includes -loop 0', () => {
    const args = buildGifArgs('in.mp4', 'out.gif', {});
    expect(args).toContain('-loop');
    expect(args).toContain('0');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
