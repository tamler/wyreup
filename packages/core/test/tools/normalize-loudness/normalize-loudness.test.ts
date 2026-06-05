/**
 * normalize-loudness tests
 *
 * 1. Metadata — always run.
 * 2. LOUDNESS_TARGETS, buildLoudnormArgs — pure, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeLoudness,
  defaultNormalizeLoudnessParams,
  LOUDNESS_TARGETS,
  buildLoudnormArgs,
} from '../../../src/tools/normalize-loudness/index.js';

describe('normalize-loudness — metadata', () => {
  it('has id "normalize-loudness"', () => expect(normalizeLoudness.id).toBe('normalize-loudness'));
  it('accepts audio and video', () => {
    expect(normalizeLoudness.input.accept).toContain('audio/*');
    expect(normalizeLoudness.input.accept).toContain('video/*');
  });
  it('output mime preserves container (*/*)', () => expect(normalizeLoudness.output.mime).toBe('*/*'));
  it('default preset is spotify', () => expect(defaultNormalizeLoudnessParams.preset).toBe('spotify'));
});

describe('normalize-loudness — LOUDNESS_TARGETS', () => {
  it('spotify is -14 LUFS', () => expect(LOUDNESS_TARGETS.spotify.I).toBe(-14));
  it('ebu-r128 is -23 LUFS / -1 dBTP', () => {
    expect(LOUDNESS_TARGETS['ebu-r128']).toEqual({ I: -23, TP: -1.0 });
  });
  it('atsc-a85 is -24 LUFS / -2 dBTP', () => {
    expect(LOUDNESS_TARGETS['atsc-a85']).toEqual({ I: -24, TP: -2.0 });
  });
});

describe('normalize-loudness — buildLoudnormArgs()', () => {
  it('encodes the preset target into the loudnorm filter', () => {
    const args = buildLoudnormArgs('in.mp3', 'out.mp3', 'spotify', false);
    const af = args[args.indexOf('-af') + 1];
    expect(af).toContain('I=-14');
    expect(af).toContain('TP=-1');
    expect(af).toContain('LRA=11');
  });
  it('copies the video stream when input has video', () => {
    const args = buildLoudnormArgs('in.mp4', 'out.mp4', 'apple-music', true);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
  });
  it('omits -c:v for audio-only input', () => {
    const args = buildLoudnormArgs('in.mp3', 'out.mp3', 'spotify', false);
    expect(args).not.toContain('-c:v');
  });
  it('throws on unknown preset', () => {
    // @ts-expect-error testing runtime guard
    expect(() => buildLoudnormArgs('in.mp3', 'out.mp3', 'tidal', false)).toThrow(/unknown/i);
  });
  it('output is last arg', () => {
    expect(buildLoudnormArgs('in.mp3', 'out.mp3', 'spotify', false).at(-1)).toBe('out.mp3');
  });
});
