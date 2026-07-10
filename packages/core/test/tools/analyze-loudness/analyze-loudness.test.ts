/**
 * analyze-loudness tests
 *
 * 1. Metadata — always run.
 * 2. buildAnalyzeArgs, parseEbur128Summary — pure, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeLoudness,
  buildAnalyzeArgs,
  parseEbur128Summary,
} from '../../../src/tools/analyze-loudness/index.js';

const SAMPLE_LOG = `[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         -16.2 LUFS
    Threshold: -26.8 LUFS

  Loudness range:
    LRA:         6.4 LU
    Threshold: -36.9 LUFS
    LRA low:   -20.1 LUFS
    LRA high:  -13.7 LUFS

  True peak:
    Peak:        -1.3 dBFS
`;

describe('analyze-loudness — metadata', () => {
  it('has id "analyze-loudness"', () => expect(analyzeLoudness.id).toBe('analyze-loudness'));
  it('output mime is application/json', () =>
    expect(analyzeLoudness.output.mime).toBe('application/json'));
  it('accepts audio and video', () => {
    expect(analyzeLoudness.input.accept).toContain('audio/*');
    expect(analyzeLoudness.input.accept).toContain('video/*');
  });
});

describe('analyze-loudness — buildAnalyzeArgs()', () => {
  it('uses ebur128 with peak detection', () => {
    const args = buildAnalyzeArgs('in.mp3');
    expect(args[args.indexOf('-af') + 1]).toBe('ebur128=peak=true');
  });
  it('discards output to null muxer', () => {
    const args = buildAnalyzeArgs('in.mp3');
    expect(args[args.indexOf('-f') + 1]).toBe('null');
    expect(args.at(-1)).toBe('-');
  });
});

describe('analyze-loudness — parseEbur128Summary()', () => {
  it('extracts integrated loudness', () => {
    expect(parseEbur128Summary(SAMPLE_LOG).integratedLufs).toBe(-16.2);
  });
  it('extracts loudness range (not the LRA low/high lines)', () => {
    expect(parseEbur128Summary(SAMPLE_LOG).loudnessRange).toBe(6.4);
  });
  it('extracts true peak', () => {
    expect(parseEbur128Summary(SAMPLE_LOG).truePeakDbtp).toBe(-1.3);
  });
  it('extracts the integrated threshold (first Threshold line)', () => {
    expect(parseEbur128Summary(SAMPLE_LOG).threshold).toBe(-26.8);
  });
  it('returns nulls for an empty log rather than throwing', () => {
    expect(parseEbur128Summary('')).toEqual({
      integratedLufs: null,
      loudnessRange: null,
      truePeakDbtp: null,
      threshold: null,
    });
  });
});
