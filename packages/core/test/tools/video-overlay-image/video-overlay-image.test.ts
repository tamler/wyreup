/**
 * video-overlay-image tests
 *
 * 1. Metadata — always run.
 * 2. overlayPositionToXY, buildOverlayFilter — pure functions, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoOverlayImage,
  defaultVideoOverlayImageParams,
  overlayPositionToXY,
  buildOverlayFilter,
} from '../../../src/tools/video-overlay-image/index.js';

describe('video-overlay-image — metadata', () => {
  it('has id "video-overlay-image"', () => expect(videoOverlayImage.id).toBe('video-overlay-image'));
  it('category is "media"', () => expect(videoOverlayImage.category).toBe('media'));
  it('accepts video/*', () => expect(videoOverlayImage.input.accept).toContain('video/*'));
  it('accepts image/*', () => expect(videoOverlayImage.input.accept).toContain('image/*'));
  it('output mime is video/mp4', () => expect(videoOverlayImage.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(videoOverlayImage.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoOverlayImage.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoOverlayImage.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoOverlayImage.cost).toBe('free'));
  it('batchable is false', () => expect(videoOverlayImage.batchable).toBe(false));
  it('input min is 2, max is 2', () => {
    expect(videoOverlayImage.input.min).toBe(2);
    expect(videoOverlayImage.input.max).toBe(2);
  });
  it('defaults position is bottom-right', () => expect(defaultVideoOverlayImageParams.position).toBe('bottom-right'));
  it('defaults margin is 20', () => expect(defaultVideoOverlayImageParams.margin).toBe(20));
  it('defaults scale is 0.15', () => expect(defaultVideoOverlayImageParams.scale).toBe(0.15));
  it('defaults opacity is 1.0', () => expect(defaultVideoOverlayImageParams.opacity).toBe(1.0));
  it('defaults startSeconds is 0', () => expect(defaultVideoOverlayImageParams.startSeconds).toBe(0));
});

describe('video-overlay-image — overlayPositionToXY()', () => {
  it('top-left -> x=margin, y=margin', () => {
    const { x, y } = overlayPositionToXY('top-left', 20);
    expect(x).toBe('20');
    expect(y).toBe('20');
  });

  it('top-right -> x includes W-w', () => {
    const { x } = overlayPositionToXY('top-right', 20);
    expect(x).toContain('W-w');
  });

  it('bottom-left -> y includes H-h', () => {
    const { y } = overlayPositionToXY('bottom-left', 20);
    expect(y).toContain('H-h');
  });

  it('bottom-right -> both contain edge expressions', () => {
    const { x, y } = overlayPositionToXY('bottom-right', 10);
    expect(x).toContain('W-w');
    expect(y).toContain('H-h');
  });

  it('center -> centered expressions', () => {
    const { x, y } = overlayPositionToXY('center', 20);
    expect(x).toContain('W-w');
    expect(y).toContain('H-h');
  });
});

describe('video-overlay-image — buildOverlayFilter()', () => {
  it('includes scale filter', () => {
    const f = buildOverlayFilter({ scale: 0.15 });
    expect(f).toContain('scale=iw*0.15');
  });

  it('includes colorchannelmixer when opacity < 1', () => {
    const f = buildOverlayFilter({ opacity: 0.5 });
    expect(f).toContain('colorchannelmixer');
    expect(f).toContain('aa=0.50');
  });

  it('no colorchannelmixer when opacity = 1', () => {
    const f = buildOverlayFilter({ opacity: 1.0 });
    expect(f).not.toContain('colorchannelmixer');
  });

  it('includes overlay filter', () => {
    const f = buildOverlayFilter({});
    expect(f).toContain('overlay=');
  });

  it('includes enable expression for duration', () => {
    const f = buildOverlayFilter({ startSeconds: 2, durationSeconds: 5 });
    expect(f).toContain("enable='between(t,2,7)'");
  });

  it('includes enable expression for start > 0 only', () => {
    const f = buildOverlayFilter({ startSeconds: 3 });
    expect(f).toContain("enable='gte(t,3)'");
  });

  it('no enable when start=0 and no duration', () => {
    const f = buildOverlayFilter({ startSeconds: 0 });
    expect(f).not.toContain('enable=');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
