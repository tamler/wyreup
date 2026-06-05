/**
 * rotate-video tests
 *
 * 1. Metadata — always run.
 * 2. getRotateFilter, buildRotateArgs — pure functions, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  rotateVideo,
  defaultRotateVideoParams,
  getRotateFilter,
  buildRotateArgs,
  type RotateMode,
} from '../../../src/tools/rotate-video/index.js';

describe('rotate-video — metadata', () => {
  it('has id "rotate-video"', () => expect(rotateVideo.id).toBe('rotate-video'));
  it('category is "media"', () => expect(rotateVideo.category).toBe('media'));
  it('output mime is video/mp4', () => expect(rotateVideo.output.mime).toBe('video/mp4'));
  it('installGroup is "ffmpeg"', () => expect(rotateVideo.installGroup).toBe('ffmpeg'));
  it('default mode is 90cw', () => expect(defaultRotateVideoParams.mode).toBe('90cw'));
  it('guards long inputs with a duration budget', () => {
    expect(rotateVideo.budget?.maxDuration).toBe(7_200);
  });
});

describe('rotate-video — getRotateFilter()', () => {
  const cases: Array<[RotateMode, string]> = [
    ['90cw', 'transpose=1'],
    ['90ccw', 'transpose=2'],
    ['180', 'transpose=1,transpose=1'],
    ['flip-h', 'hflip'],
    ['flip-v', 'vflip'],
    ['flip-both', 'hflip,vflip'],
  ];
  for (const [mode, filter] of cases) {
    it(`${mode} -> ${filter}`, () => expect(getRotateFilter(mode)).toBe(filter));
  }
  it('throws on unknown mode', () => {
    expect(() => getRotateFilter('sideways' as RotateMode)).toThrow(/unknown/i);
  });
});

describe('rotate-video — buildRotateArgs()', () => {
  it('places the transform in -vf', () => {
    const args = buildRotateArgs('in.mp4', 'out.mp4', { mode: 'flip-h' });
    const vfIdx = args.indexOf('-vf');
    expect(args[vfIdx + 1]).toBe('hflip');
  });
  it('copies audio', () => {
    const args = buildRotateArgs('in.mp4', 'out.mp4', { mode: '90cw' });
    const caIdx = args.indexOf('-c:a');
    expect(args[caIdx + 1]).toBe('copy');
  });
  it('output is last arg', () => {
    expect(buildRotateArgs('in.mp4', 'out.mp4', { mode: '180' }).at(-1)).toBe('out.mp4');
  });
});
