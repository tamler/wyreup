/**
 * convert-audio tests
 *
 * Structure:
 *  1. Metadata — always run, no deps.
 *  2. Pure helpers (getAudioCodec, getAudioMime) — always run.
 *  3. run() — requires ffmpeg.wasm which loads from CDN and needs a browser
 *     environment (SharedArrayBuffer). Skipped in Node vitest with a clear comment.
 */

import { describe, it, expect } from 'vitest';
import {
  convertAudio,
  defaultConvertAudioParams,
  getAudioCodec,
  getAudioMime,
} from '../../../src/tools/convert-audio/index.js';

// ──── 1. Metadata ────

describe('convert-audio — metadata', () => {
  it('has id "convert-audio"', () => {
    expect(convertAudio.id).toBe('convert-audio');
  });

  it('category is "media"', () => {
    expect(convertAudio.category).toBe('media');
  });

  it('slug is "convert-audio"', () => {
    expect(convertAudio.slug).toBe('convert-audio');
  });

  it('accepts audio/*', () => {
    expect(convertAudio.input.accept).toContain('audio/*');
  });

  it('installSize is 30 MB', () => {
    expect(convertAudio.installSize).toBe(30_000_000);
  });

  it('installGroup is "ffmpeg"', () => {
    expect(convertAudio.installGroup).toBe('ffmpeg');
  });

  it('memoryEstimate is "high"', () => {
    expect(convertAudio.memoryEstimate).toBe('high');
  });

  it('cost is "free"', () => {
    expect(convertAudio.cost).toBe('free');
  });

  it('batchable is false', () => {
    expect(convertAudio.batchable).toBe(false);
  });

  it('has no requires field', () => {
    expect(convertAudio.requires).toBeUndefined();
  });

  it('defaults to mp3 format', () => {
    expect(defaultConvertAudioParams.format).toBe('mp3');
  });

  it('defaults to 192k bitrate', () => {
    expect(defaultConvertAudioParams.bitrate).toBe('192k');
  });
});

// ──── 2. Pure helpers ────

describe('convert-audio — getAudioCodec()', () => {
  it('mp3 -> libmp3lame', () => expect(getAudioCodec('mp3')).toBe('libmp3lame'));
  it('wav -> pcm_s16le', () => expect(getAudioCodec('wav')).toBe('pcm_s16le'));
  it('ogg -> libvorbis', () => expect(getAudioCodec('ogg')).toBe('libvorbis'));
  it('flac -> flac', () => expect(getAudioCodec('flac')).toBe('flac'));
  it('aac -> aac', () => expect(getAudioCodec('aac')).toBe('aac'));
  it('m4a -> aac', () => expect(getAudioCodec('m4a')).toBe('aac'));
  it('opus -> libopus', () => expect(getAudioCodec('opus')).toBe('libopus'));
});

describe('convert-audio — getAudioMime()', () => {
  it('mp3 -> audio/mpeg', () => expect(getAudioMime('mp3')).toBe('audio/mpeg'));
  it('wav -> audio/wav', () => expect(getAudioMime('wav')).toBe('audio/wav'));
  it('flac -> audio/flac', () => expect(getAudioMime('flac')).toBe('audio/flac'));
});

// ──── 3. run() — skipped in Node ────
//
// ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP headers) and loads from CDN.
// Running run() in vitest/Node is not supported and would fail trying to load
// the WASM binary. The metadata and helper tests above cover correctness.
// Full pipeline tests run in a browser with COOP/COEP headers configured.
