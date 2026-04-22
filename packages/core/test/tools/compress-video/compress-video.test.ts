/**
 * compress-video tests
 *
 * 1. Metadata — always run.
 * 2. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import { compressVideo, defaultCompressVideoParams } from '../../../src/tools/compress-video/index.js';

describe('compress-video — metadata', () => {
  it('has id "compress-video"', () => expect(compressVideo.id).toBe('compress-video'));
  it('category is "media"', () => expect(compressVideo.category).toBe('media'));
  it('accepts video/*', () => expect(compressVideo.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(compressVideo.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(compressVideo.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(compressVideo.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(compressVideo.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(compressVideo.cost).toBe('free'));
  it('batchable is false', () => expect(compressVideo.batchable).toBe(false));
  it('no requires field', () => expect(compressVideo.requires).toBeUndefined());
  it('defaults crf is 28', () => expect(defaultCompressVideoParams.crf).toBe(28));
  it('defaults preset is fast', () => expect(defaultCompressVideoParams.preset).toBe('fast'));
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
