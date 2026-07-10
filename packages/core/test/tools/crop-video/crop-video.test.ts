import { describe, it, expect } from 'vitest';
import { cropVideo, buildCropArgs } from '../../../src/tools/crop-video/index.js';

describe('crop-video', () => {
  it('id + budget', () => {
    expect(cropVideo.id).toBe('crop-video');
    expect(cropVideo.budget?.maxDuration).toBe(7_200);
  });
  it('builds crop=w:h:x:y', () => {
    const args = buildCropArgs('in.mp4', 'out.mp4', { width: 640, height: 480, x: 10, y: 20 });
    expect(args[args.indexOf('-vf') + 1]).toBe('crop=640:480:10:20');
    expect(args.at(-1)).toBe('out.mp4');
  });
  it('clamps negative offsets to 0', () => {
    const args = buildCropArgs('in.mp4', 'out.mp4', { width: 100, height: 100, x: -5, y: -9 });
    expect(args[args.indexOf('-vf') + 1]).toBe('crop=100:100:0:0');
  });
  it('throws on non-positive dimensions', () => {
    expect(() => buildCropArgs('in.mp4', 'out.mp4', { width: 0, height: 100, x: 0, y: 0 })).toThrow(
      /positive/i,
    );
  });
});
