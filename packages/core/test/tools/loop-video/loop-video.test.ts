import { describe, it, expect } from 'vitest';
import { loopVideo, buildLoopArgs } from '../../../src/tools/loop-video/index.js';

describe('loop-video', () => {
  it('id + preserves container', () => {
    expect(loopVideo.id).toBe('loop-video');
    expect(loopVideo.output.mime).toBe('*/*');
  });
  it('puts -stream_loop before -i and stream-copies', () => {
    const args = buildLoopArgs('in.mp4', 'out.mp4', 2);
    expect(args.indexOf('-stream_loop')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-stream_loop') + 1]).toBe('2');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
  });
  it('clamps loops to >= 1', () => {
    expect(buildLoopArgs('in.mp4', 'out.mp4', 0)[1]).toBe('1');
  });
});
