/**
 * convert-video tests
 *
 * 1. Metadata — always run.
 * 2. Pure helpers (getVideoMime) — always run.
 * 3. run() — requires ffmpeg.wasm (CDN + SharedArrayBuffer). Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  convertVideo,
  defaultConvertVideoParams,
  getVideoMime,
} from '../../../src/tools/convert-video/index.js';

describe('convert-video — metadata', () => {
  it('has id "convert-video"', () => {
    expect(convertVideo.id).toBe('convert-video');
  });

  it('category is "media"', () => {
    expect(convertVideo.category).toBe('media');
  });

  it('accepts video/*', () => {
    expect(convertVideo.input.accept).toContain('video/*');
  });

  it('installSize is 30 MB', () => {
    expect(convertVideo.installSize).toBe(30_000_000);
  });

  it('installGroup is "ffmpeg"', () => {
    expect(convertVideo.installGroup).toBe('ffmpeg');
  });

  it('memoryEstimate is "high"', () => {
    expect(convertVideo.memoryEstimate).toBe('high');
  });

  it('cost is "free"', () => {
    expect(convertVideo.cost).toBe('free');
  });

  it('batchable is false', () => {
    expect(convertVideo.batchable).toBe(false);
  });

  it('no requires field', () => {
    expect(convertVideo.requires).toBeUndefined();
  });

  it('defaults to mp4', () => {
    expect(defaultConvertVideoParams.format).toBe('mp4');
  });

  it('defaults crf is 23', () => {
    expect(defaultConvertVideoParams.crf).toBe(23);
  });

  it('defaults preset is medium', () => {
    expect(defaultConvertVideoParams.preset).toBe('medium');
  });
});

describe('convert-video — getVideoMime()', () => {
  it('mp4 -> video/mp4', () => expect(getVideoMime('mp4')).toBe('video/mp4'));
  it('webm -> video/webm', () => expect(getVideoMime('webm')).toBe('video/webm'));
  it('mkv -> video/x-matroska', () => expect(getVideoMime('mkv')).toBe('video/x-matroska'));
  it('mov -> video/quicktime', () => expect(getVideoMime('mov')).toBe('video/quicktime'));
  it('avi -> video/x-msvideo', () => expect(getVideoMime('avi')).toBe('video/x-msvideo'));
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
