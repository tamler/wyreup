import { describe, it, expect } from 'vitest';
import { videoVolume, buildVolumeArgs } from '../../../src/tools/video-volume/index.js';

describe('video-volume', () => {
  it('id + preserves container', () => {
    expect(videoVolume.id).toBe('video-volume');
    expect(videoVolume.output.mime).toBe('*/*');
  });
  it('applies the volume filter', () => {
    const args = buildVolumeArgs('in.mp3', 'out.mp3', 1.5, false);
    expect(args[args.indexOf('-af') + 1]).toBe('volume=1.5');
  });
  it('copies video stream for video input', () => {
    const args = buildVolumeArgs('in.mp4', 'out.mp4', 2, true);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
  });
  it('omits -c:v for audio-only', () => {
    expect(buildVolumeArgs('in.mp3', 'out.mp3', 2, false)).not.toContain('-c:v');
  });
  it('throws on negative gain', () => {
    expect(() => buildVolumeArgs('in.mp3', 'out.mp3', -1, false)).toThrow(/>= 0/);
  });
});
