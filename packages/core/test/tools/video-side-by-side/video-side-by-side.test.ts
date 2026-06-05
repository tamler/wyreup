import { describe, it, expect } from 'vitest';
import { videoSideBySide, buildSideBySideArgs } from '../../../src/tools/video-side-by-side/index.js';

describe('video-side-by-side', () => {
  it('id + two video inputs', () => {
    expect(videoSideBySide.id).toBe('video-side-by-side');
    expect(videoSideBySide.input.min).toBe(2);
    expect(videoSideBySide.input.accept).toContain('video/*');
  });
  it('horizontal uses hstack with matched heights', () => {
    const f = buildSideBySideArgs('a.mp4', 'b.mp4', 'out.mp4', 'horizontal')[
      buildSideBySideArgs('a.mp4', 'b.mp4', 'out.mp4', 'horizontal').indexOf('-filter_complex') + 1
    ];
    expect(f).toContain('hstack=inputs=2');
    expect(f).toContain('scale=-2:720');
  });
  it('vertical uses vstack with matched widths', () => {
    const args = buildSideBySideArgs('a.mp4', 'b.mp4', 'out.mp4', 'vertical');
    const f = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(f).toContain('vstack=inputs=2');
    expect(f).toContain('scale=720:-2');
  });
});
