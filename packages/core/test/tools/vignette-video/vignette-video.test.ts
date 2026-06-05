import { describe, it, expect } from 'vitest';
import { vignetteVideo, buildVignetteArgs } from '../../../src/tools/vignette-video/index.js';

describe('vignette-video', () => {
  it('id + budget', () => {
    expect(vignetteVideo.id).toBe('vignette-video');
    expect(vignetteVideo.budget?.maxDuration).toBe(7_200);
  });
  it('maps strength to a vignette angle', () => {
    const args = buildVignetteArgs('in.mp4', 'out.mp4', 1);
    const vf = args[args.indexOf('-vf') + 1] ?? '';
    expect(vf).toMatch(/^vignette=angle=/);
    // strength 1 -> angle PI/2 ~ 1.5708
    expect(vf).toContain('1.5708');
  });
  it('copies audio', () => {
    const args = buildVignetteArgs('in.mp4', 'out.mp4', 0.4);
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
  });
});
