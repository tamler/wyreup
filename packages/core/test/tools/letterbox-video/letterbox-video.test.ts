import { describe, it, expect } from 'vitest';
import { letterboxVideo, LETTERBOX_CANVAS, buildLetterboxArgs } from '../../../src/tools/letterbox-video/index.js';

describe('letterbox-video', () => {
  it('id + budget', () => {
    expect(letterboxVideo.id).toBe('letterbox-video');
    expect(letterboxVideo.budget?.maxDuration).toBe(7_200);
  });
  it('16:9 canvas is 1920x1080', () => {
    expect(LETTERBOX_CANVAS['16:9']).toEqual({ w: 1920, h: 1080 });
  });
  it('scales to fit then pads to the canvas', () => {
    const vf = buildLetterboxArgs('in.mp4', 'out.mp4', '9:16')[
      buildLetterboxArgs('in.mp4', 'out.mp4', '9:16').indexOf('-vf') + 1
    ];
    expect(vf).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
    expect(vf).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
  });
  it('throws on unknown aspect', () => {
    // @ts-expect-error runtime guard
    expect(() => buildLetterboxArgs('in.mp4', 'out.mp4', '21:9')).toThrow(/aspect/i);
  });
});
