/**
 * video-concat tests
 *
 * 1. Metadata — always run.
 * 2. buildConcatArgs — pure function, always run.
 * 3. run() — requires ffmpeg.wasm (CDN + SharedArrayBuffer). Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoConcat,
  defaultVideoConcatParams,
  buildConcatArgs,
} from '../../../src/tools/video-concat/index.js';

describe('video-concat — metadata', () => {
  it('has id "video-concat"', () => expect(videoConcat.id).toBe('video-concat'));
  it('category is "media"', () => expect(videoConcat.category).toBe('media'));
  it('accepts video/*', () => expect(videoConcat.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(videoConcat.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(videoConcat.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoConcat.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoConcat.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoConcat.cost).toBe('free'));
  it('batchable is false', () => expect(videoConcat.batchable).toBe(false));
  it('input min is 2', () => expect(videoConcat.input.min).toBe(2));
  it('input max is 20', () => expect(videoConcat.input.max).toBe(20));
  it('defaults reencode is false', () => expect(defaultVideoConcatParams.reencode).toBe(false));
  it('defaults preset is fast', () => expect(defaultVideoConcatParams.preset).toBe('fast'));
  it('defaults crf is 23', () => expect(defaultVideoConcatParams.crf).toBe(23));
});

describe('video-concat — buildConcatArgs()', () => {
  it('uses -f concat and list.txt', () => {
    const args = buildConcatArgs(2, false, 'fast', 23);
    expect(args).toContain('-f');
    expect(args).toContain('concat');
    expect(args).toContain('list.txt');
  });

  it('stream-copy when reencode=false', () => {
    const args = buildConcatArgs(2, false, 'fast', 23);
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).not.toContain('libx264');
  });

  it('uses libx264 when reencode=true', () => {
    const args = buildConcatArgs(2, true, 'medium', 23);
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-preset');
    expect(args).toContain('medium');
    expect(args).toContain('-crf');
    expect(args).toContain('23');
  });

  it('output is output.mp4', () => {
    const args = buildConcatArgs(3, false, 'fast', 23);
    expect(args[args.length - 1]).toBe('output.mp4');
  });

  it('includes -safe 0', () => {
    const args = buildConcatArgs(2, false, 'fast', 23);
    expect(args).toContain('-safe');
    expect(args).toContain('0');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
