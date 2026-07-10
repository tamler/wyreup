/**
 * mute-video tests
 *
 * 1. Metadata — always run.
 * 2. buildMuteArgs — pure function, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import { muteVideo, buildMuteArgs } from '../../../src/tools/mute-video/index.js';

describe('mute-video — metadata', () => {
  it('has id "mute-video"', () => expect(muteVideo.id).toBe('mute-video'));
  it('category is "media"', () => expect(muteVideo.category).toBe('media'));
  it('accepts video/*', () => expect(muteVideo.input.accept).toContain('video/*'));
  it('output mime preserves container (*/*)', () => expect(muteVideo.output.mime).toBe('*/*'));
  it('installGroup is "ffmpeg"', () => expect(muteVideo.installGroup).toBe('ffmpeg'));
  it('cost is "free"', () => expect(muteVideo.cost).toBe('free'));
});

describe('mute-video — buildMuteArgs()', () => {
  it('drops audio with -an', () => {
    expect(buildMuteArgs('in.mp4', 'out.mp4')).toContain('-an');
  });
  it('stream-copies (no re-encode)', () => {
    const args = buildMuteArgs('in.mp4', 'out.mp4');
    const cIdx = args.indexOf('-c');
    expect(args[cIdx + 1]).toBe('copy');
  });
  it('reads the input file', () => {
    const args = buildMuteArgs('in.webm', 'out.webm');
    const iIdx = args.indexOf('-i');
    expect(args[iIdx + 1]).toBe('in.webm');
  });
  it('output is last arg', () => {
    expect(buildMuteArgs('in.mp4', 'out.mp4').at(-1)).toBe('out.mp4');
  });
});
