import { describe, it, expect } from 'vitest';
import { reverseVideo, buildReverseArgs } from '../../../src/tools/reverse-video/index.js';

describe('reverse-video', () => {
  it('id + tight duration budget', () => {
    expect(reverseVideo.id).toBe('reverse-video');
    expect(reverseVideo.budget?.maxDuration).toBe(1_800);
  });
  it('reverses video and audio by default', () => {
    const args = buildReverseArgs('in.mp4', 'out.mp4', { reverseAudio: true });
    expect(args[args.indexOf('-vf') + 1]).toBe('reverse');
    expect(args[args.indexOf('-af') + 1]).toBe('areverse');
  });
  it('drops audio when reverseAudio is false', () => {
    const args = buildReverseArgs('in.mp4', 'out.mp4', { reverseAudio: false });
    expect(args).toContain('-an');
    expect(args).not.toContain('areverse');
  });
});
