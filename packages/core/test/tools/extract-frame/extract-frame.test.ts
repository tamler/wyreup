/**
 * extract-frame tests
 *
 * 1. Metadata — always run.
 * 2. getFrameMime, getFrameExt, buildExtractFrameArgs — pure, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  extractFrame,
  defaultExtractFrameParams,
  getFrameMime,
  getFrameExt,
  buildExtractFrameArgs,
} from '../../../src/tools/extract-frame/index.js';

describe('extract-frame — metadata', () => {
  it('has id "extract-frame"', () => expect(extractFrame.id).toBe('extract-frame'));
  it('category is "media"', () => expect(extractFrame.category).toBe('media'));
  it('accepts video/*', () => expect(extractFrame.input.accept).toContain('video/*'));
  it('output mime is image/*', () => expect(extractFrame.output.mime).toBe('image/*'));
  it('default format is png', () => expect(defaultExtractFrameParams.format).toBe('png'));
});

describe('extract-frame — format maps', () => {
  it('png -> image/png / .png', () => {
    expect(getFrameMime('png')).toBe('image/png');
    expect(getFrameExt('png')).toBe('png');
  });
  it('jpeg -> image/jpeg / .jpg', () => {
    expect(getFrameMime('jpeg')).toBe('image/jpeg');
    expect(getFrameExt('jpeg')).toBe('jpg');
  });
});

describe('extract-frame — buildExtractFrameArgs()', () => {
  it('seeks with -ss before -i', () => {
    const args = buildExtractFrameArgs('in.mp4', 'out.png', { timestamp: 5 });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('5');
  });
  it('captures exactly one frame', () => {
    const args = buildExtractFrameArgs('in.mp4', 'out.png', { timestamp: 0 });
    const vfIdx = args.indexOf('-vframes');
    expect(args[vfIdx + 1]).toBe('1');
  });
  it('clamps negative timestamps to 0', () => {
    const args = buildExtractFrameArgs('in.mp4', 'out.png', { timestamp: -3 });
    expect(args[args.indexOf('-ss') + 1]).toBe('0');
  });
  it('defaults timestamp to 0 when unset', () => {
    const args = buildExtractFrameArgs('in.mp4', 'out.png', {});
    expect(args[args.indexOf('-ss') + 1]).toBe('0');
  });
  it('output is last arg', () => {
    expect(buildExtractFrameArgs('in.mp4', 'out.jpg', {}).at(-1)).toBe('out.jpg');
  });
});
