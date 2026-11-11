import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioDurationError,
  HOSTED_AUDIO_MAX_SECONDS,
  assertHostedAudioDuration,
  measureAudioDuration,
} from '../../../src/lib/audio-duration.js';
import { estimateTokens, truncateToTokens } from '../../../src/lib/pro-limits.js';
import { transcribePro } from '../../../src/tools/transcribe-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function wav(opts: {
  seconds: number;
  sampleRate?: number;
  channels?: number;
  bits?: number;
  format?: number;
  byteRateOverride?: number;
  declaredData?: number;
}): Uint8Array {
  const sampleRate = opts.sampleRate ?? 8_000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const blockAlign = (channels * bits) / 8;
  const byteRate = opts.byteRateOverride ?? sampleRate * blockAlign;
  const dataLen = Math.round(opts.seconds * sampleRate * blockAlign);
  const bytes = new Uint8Array(44 + dataLen);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, opts.format ?? 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  tag(36, 'data');
  view.setUint32(40, opts.declaredData ?? dataLen, true);
  return bytes;
}

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz frames: 417 bytes, 1,152 samples each. */
function mp3(frames: number, prefix: number[] = [], suffix: number[] = []): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const out = new Uint8Array(prefix.length + frames * 417 + suffix.length);
  out.set(prefix);
  for (let i = 0; i < frames; i++) out.set(frame, prefix.length + i * 417);
  out.set(suffix, prefix.length + frames * 417);
  return out;
}

describe('measureAudioDuration', () => {
  it('measures PCM WAV from its data bytes', () => {
    expect(measureAudioDuration(wav({ seconds: 2 }))).toEqual({ format: 'wav', seconds: 2 });
    expect(measureAudioDuration(wav({ seconds: 1, bits: 8 })).seconds).toBe(1);
    expect(measureAudioDuration(wav({ seconds: 1, format: 7, bits: 8 })).seconds).toBe(1);
  });

  it('counts the bytes present when the data size is streamed or overstated', () => {
    expect(measureAudioDuration(wav({ seconds: 1, declaredData: 0xffffffff })).seconds).toBe(1);
    expect(measureAudioDuration(wav({ seconds: 1, declaredData: 10_000_000 })).seconds).toBe(1);
  });

  it('rejects a WAV whose byte rate disagrees with its sample format', () => {
    // A faked high byte rate would make a long file look short.
    expect(() => measureAudioDuration(wav({ seconds: 1, byteRateOverride: 1_600_000 }))).toThrow(
      AudioDurationError,
    );
    expect(() => measureAudioDuration(wav({ seconds: 1, format: 2 }))).toThrow(
      'compressed or inconsistent',
    );
  });

  it('sums MP3 frame durations, skipping ID3 tags', () => {
    const seconds = (100 * 1152) / 44_100;
    expect(measureAudioDuration(mp3(100)).seconds).toBeCloseTo(seconds, 6);
    const id3 = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array<number>(10).fill(0)];
    expect(measureAudioDuration(mp3(100, id3)).seconds).toBeCloseTo(seconds, 6);
    const tag = [0x54, 0x41, 0x47, ...new Array<number>(125).fill(0)];
    expect(measureAudioDuration(mp3(100, [], tag)).seconds).toBeCloseTo(seconds, 6);
  });

  it('rejects an MP3 with non-frame data that could hide audio', () => {
    expect(() => measureAudioDuration(mp3(10, [], new Array<number>(5_000).fill(7)))).toThrow(
      'not audio frames',
    );
  });

  it('prices a short damaged tail at the lowest MP3 bitrate', () => {
    const base = (10 * 1152) / 44_100;
    expect(measureAudioDuration(mp3(10, [], new Array<number>(1_000).fill(7))).seconds).toBeCloseTo(
      base + 1,
      6,
    );
  });

  it('refuses containers whose length cannot be verified', () => {
    const m4a = new TextEncoder().encode(
      '\u0000\u0000\u0000\u0018ftypM4A \u0000\u0000\u0000\u0000',
    );
    const ogg = new TextEncoder().encode('OggS\u0000\u0002');
    for (const bytes of [m4a, ogg, new Uint8Array([1, 2, 3])]) {
      expect(() => measureAudioDuration(bytes)).toThrow('WAV or MP3');
    }
  });

  it('enforces the 45-minute cap', () => {
    expect(HOSTED_AUDIO_MAX_SECONDS).toBe(45 * 60);
    expect(assertHostedAudioDuration(wav({ seconds: 45 * 60, bits: 8 })).seconds).toBe(2_700);
    expect(() => assertHostedAudioDuration(wav({ seconds: 45 * 60 + 1, bits: 8 }))).toThrow(
      'up to 45 minutes',
    );
  });
});

describe('truncateToTokens', () => {
  it('keeps text within the cap and never splits a surrogate pair', () => {
    expect(truncateToTokens('short', 10)).toBe('short');
    const cut = truncateToTokens('漢'.repeat(500), 100);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(100);
    const emoji = truncateToTokens('😀'.repeat(100), 51);
    expect(estimateTokens(emoji)).toBeLessThanOrEqual(51);
    expect(emoji.length % 2).toBe(0);
  });
});

describe('transcribe-pro client check', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('refuses an M4A before uploading anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'transcribe-check',
      apiKey: 'k',
    };
    const file = new File([new TextEncoder().encode('\u0000\u0000\u0000\u0018ftypM4A ')], 'a.m4a', {
      type: 'audio/mp4',
    });
    await expect(transcribePro.run([file], {}, ctx)).rejects.toThrow('WAV or MP3');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
