import { describe, it, expect } from 'vitest';
import { fadeVideo, buildFadeFilters, buildFadeArgs } from '../../../src/tools/fade-video/index.js';

describe('fade-video', () => {
  it('id + budget', () => {
    expect(fadeVideo.id).toBe('fade-video');
    expect(fadeVideo.budget?.maxDuration).toBe(7_200);
  });
  it('fade-in starts at 0, fade-out at duration - fadeOut', () => {
    const { video, audio } = buildFadeFilters({ fadeIn: 1, fadeOut: 2 }, 10);
    expect(video).toBe('fade=t=in:st=0:d=1,fade=t=out:st=8.000:d=2');
    expect(audio).toBe('afade=t=in:st=0:d=1,afade=t=out:st=8.000:d=2');
  });
  it('omits fade-out when duration is unknown', () => {
    const { video } = buildFadeFilters({ fadeIn: 1, fadeOut: 2 }, NaN);
    expect(video).toBe('fade=t=in:st=0:d=1');
  });
  it('throws when both fades are 0', () => {
    expect(() => buildFadeFilters({ fadeIn: 0, fadeOut: 0 }, 10)).toThrow(/greater than 0/);
  });
  it('buildFadeArgs includes -vf and -af', () => {
    const args = buildFadeArgs('in.mp4', 'out.mp4', { fadeIn: 1, fadeOut: 1 }, 10);
    expect(args).toContain('-vf');
    expect(args).toContain('-af');
  });
});
