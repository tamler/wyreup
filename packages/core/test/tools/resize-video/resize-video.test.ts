/**
 * resize-video tests
 *
 * 1. Metadata — always run.
 * 2. buildScaleFilter, buildResizeArgs — pure functions, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  resizeVideo,
  defaultResizeVideoParams,
  buildScaleFilter,
  buildResizeArgs,
} from '../../../src/tools/resize-video/index.js';

describe('resize-video — metadata', () => {
  it('has id "resize-video"', () => expect(resizeVideo.id).toBe('resize-video'));
  it('category is "media"', () => expect(resizeVideo.category).toBe('media'));
  it('accepts video/*', () => expect(resizeVideo.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(resizeVideo.output.mime).toBe('video/mp4'));
  it('installGroup is "ffmpeg"', () => expect(resizeVideo.installGroup).toBe('ffmpeg'));
  it('cost is "free"', () => expect(resizeVideo.cost).toBe('free'));
  it('defaults crf is 23', () => expect(defaultResizeVideoParams.crf).toBe(23));
});

describe('resize-video — buildScaleFilter()', () => {
  it('uses -2 for blank height (preserve aspect by width)', () => {
    expect(buildScaleFilter(1280, undefined)).toBe('scale=1280:-2');
  });
  it('uses -2 for blank width (preserve aspect by height)', () => {
    expect(buildScaleFilter(undefined, 720)).toBe('scale=-2:720');
  });
  it('uses both when both provided', () => {
    expect(buildScaleFilter(640, 480)).toBe('scale=640:480');
  });
  it('rounds fractional dimensions', () => {
    expect(buildScaleFilter(640.6, undefined)).toBe('scale=641:-2');
  });
  it('throws when neither dimension is provided', () => {
    expect(() => buildScaleFilter(undefined, undefined)).toThrow(/at least one/i);
  });
  it('throws when both are zero/negative', () => {
    expect(() => buildScaleFilter(0, -10)).toThrow();
  });
});

describe('resize-video — buildResizeArgs()', () => {
  it('includes the scale filter', () => {
    const args = buildResizeArgs('in.mp4', 'out.mp4', { width: 1280 });
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).not.toBe(-1);
    expect(args[vfIdx + 1]).toBe('scale=1280:-2');
  });
  it('copies audio (no re-encode)', () => {
    const args = buildResizeArgs('in.mp4', 'out.mp4', { width: 1280 });
    const caIdx = args.indexOf('-c:a');
    expect(args[caIdx + 1]).toBe('copy');
  });
  it('uses default crf 23 when unset', () => {
    const args = buildResizeArgs('in.mp4', 'out.mp4', { height: 720 });
    const crfIdx = args.indexOf('-crf');
    expect(args[crfIdx + 1]).toBe('23');
  });
  it('output is last arg', () => {
    const args = buildResizeArgs('in.mp4', 'out.mp4', { width: 800 });
    expect(args[args.length - 1]).toBe('out.mp4');
  });
});
