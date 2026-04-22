/**
 * extract-audio tests
 *
 * 1. Metadata — always run.
 * 2. Pure helpers (getExtractCodec, getExtractMime) — always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  extractAudio,
  defaultExtractAudioParams,
  getExtractCodec,
  getExtractMime,
} from '../../../src/tools/extract-audio/index.js';

describe('extract-audio — metadata', () => {
  it('has id "extract-audio"', () => expect(extractAudio.id).toBe('extract-audio'));
  it('category is "media"', () => expect(extractAudio.category).toBe('media'));
  it('accepts video/*', () => expect(extractAudio.input.accept).toContain('video/*'));
  it('installSize is 30 MB', () => expect(extractAudio.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(extractAudio.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(extractAudio.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(extractAudio.cost).toBe('free'));
  it('batchable is false', () => expect(extractAudio.batchable).toBe(false));
  it('no requires field', () => expect(extractAudio.requires).toBeUndefined());
  it('defaults to mp3', () => expect(defaultExtractAudioParams.format).toBe('mp3'));
  it('defaults to 192k', () => expect(defaultExtractAudioParams.bitrate).toBe('192k'));
});

describe('extract-audio — getExtractCodec()', () => {
  it('mp3 -> libmp3lame', () => expect(getExtractCodec('mp3')).toBe('libmp3lame'));
  it('wav -> pcm_s16le', () => expect(getExtractCodec('wav')).toBe('pcm_s16le'));
  it('ogg -> libvorbis', () => expect(getExtractCodec('ogg')).toBe('libvorbis'));
  it('m4a -> aac', () => expect(getExtractCodec('m4a')).toBe('aac'));
});

describe('extract-audio — getExtractMime()', () => {
  it('mp3 -> audio/mpeg', () => expect(getExtractMime('mp3')).toBe('audio/mpeg'));
  it('wav -> audio/wav', () => expect(getExtractMime('wav')).toBe('audio/wav'));
  it('ogg -> audio/ogg', () => expect(getExtractMime('ogg')).toBe('audio/ogg'));
  it('m4a -> audio/mp4', () => expect(getExtractMime('m4a')).toBe('audio/mp4'));
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
