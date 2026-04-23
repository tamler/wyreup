/**
 * video-crossfade tests
 *
 * 1. Metadata — always run.
 * 2. parseDurationFromStderr, buildCrossfadeArgs — pure functions, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoCrossfade,
  defaultVideoCrossfadeParams,
  parseDurationFromStderr,
  buildCrossfadeArgs,
} from '../../../src/tools/video-crossfade/index.js';

describe('video-crossfade — metadata', () => {
  it('has id "video-crossfade"', () => expect(videoCrossfade.id).toBe('video-crossfade'));
  it('category is "media"', () => expect(videoCrossfade.category).toBe('media'));
  it('accepts video/*', () => expect(videoCrossfade.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(videoCrossfade.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(videoCrossfade.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoCrossfade.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoCrossfade.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoCrossfade.cost).toBe('free'));
  it('batchable is false', () => expect(videoCrossfade.batchable).toBe(false));
  it('presence is "both"', () => expect(videoCrossfade.presence).toBe('both'));
  it('input min is 2, max is 2', () => {
    expect(videoCrossfade.input.min).toBe(2);
    expect(videoCrossfade.input.max).toBe(2);
  });
  it('defaults fadeDuration is 1.0', () => expect(defaultVideoCrossfadeParams.fadeDuration).toBe(1.0));
  it('defaults transition is fade', () => expect(defaultVideoCrossfadeParams.transition).toBe('fade'));
  it('defaults crf is 23', () => expect(defaultVideoCrossfadeParams.crf).toBe(23));
});

describe('video-crossfade — parseDurationFromStderr()', () => {
  it('parses a standard ffmpeg duration line', () => {
    const stderr = '  Duration: 00:00:10.53, start: 0.000000, bitrate: 1234 kb/s';
    expect(parseDurationFromStderr(stderr)).toBeCloseTo(10.53, 1);
  });

  it('parses minutes correctly', () => {
    const stderr = '  Duration: 00:01:30.00, start: 0.0';
    expect(parseDurationFromStderr(stderr)).toBe(90);
  });

  it('parses hours correctly', () => {
    const stderr = '  Duration: 01:00:00.00, start: 0.0';
    expect(parseDurationFromStderr(stderr)).toBe(3600);
  });

  it('returns 0 when no duration found', () => {
    expect(parseDurationFromStderr('no duration here')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseDurationFromStderr('')).toBe(0);
  });
});

describe('video-crossfade — buildCrossfadeArgs()', () => {
  it('includes both input files', () => {
    const args = buildCrossfadeArgs('a.mp4', 'b.mp4', 'out.mp4', 1.0, 'fade', 9.0, 23);
    expect(args).toContain('a.mp4');
    expect(args).toContain('b.mp4');
  });

  it('uses xfade filter with correct transition', () => {
    const args = buildCrossfadeArgs('a.mp4', 'b.mp4', 'out.mp4', 1.0, 'wipeleft', 9.0, 23);
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1] ?? '';
    expect(fc).toContain('xfade=transition=wipeleft');
  });

  it('includes acrossfade for audio', () => {
    const args = buildCrossfadeArgs('a.mp4', 'b.mp4', 'out.mp4', 1.5, 'fade', 9.0, 23);
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1] ?? '';
    expect(fc).toContain('acrossfade=d=1.5');
  });

  it('maps [outv] and [outa]', () => {
    const args = buildCrossfadeArgs('a.mp4', 'b.mp4', 'out.mp4', 1.0, 'fade', 9.0, 23);
    expect(args).toContain('[outv]');
    expect(args).toContain('[outa]');
  });

  it('includes -crf', () => {
    const args = buildCrossfadeArgs('a.mp4', 'b.mp4', 'out.mp4', 1.0, 'fade', 9.0, 28);
    expect(args).toContain('-crf');
    expect(args).toContain('28');
  });

  it('output is last arg', () => {
    const args = buildCrossfadeArgs('a.mp4', 'b.mp4', 'out.mp4', 1.0, 'fade', 9.0, 23);
    expect(args[args.length - 1]).toBe('out.mp4');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
