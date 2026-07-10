/**
 * video-quality-metrics tests
 *
 * 1. Metadata — always run.
 * 2. buildQualityArgs, parseQualityMetrics — pure, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoQualityMetrics,
  buildQualityArgs,
  parseQualityMetrics,
} from '../../../src/tools/video-quality-metrics/index.js';

const SSIM_LINE =
  '[Parsed_ssim_1 @ 0x55] SSIM Y:0.987 (18.9) U:0.991 (20.4) V:0.992 (21.0) All:0.989 (19.5)';
const PSNR_LINE = '[Parsed_psnr_1 @ 0x55] PSNR y:42.5 u:45.1 v:46.0 average:43.4 min:38.0 max:50.0';

describe('video-quality-metrics — metadata', () => {
  it('has id "video-quality-metrics"', () =>
    expect(videoQualityMetrics.id).toBe('video-quality-metrics'));
  it('takes exactly two video inputs', () => {
    expect(videoQualityMetrics.input.min).toBe(2);
    expect(videoQualityMetrics.input.max).toBe(2);
    expect(videoQualityMetrics.input.accept).toContain('video/*');
  });
  it('output mime is application/json', () =>
    expect(videoQualityMetrics.output.mime).toBe('application/json'));
  it('guards long inputs with a duration budget', () => {
    expect(videoQualityMetrics.budget?.maxDuration).toBe(7_200);
  });
});

describe('video-quality-metrics — buildQualityArgs()', () => {
  it('scales distorted (input 1) to reference (input 0) then runs the metric', () => {
    const args = buildQualityArgs('ssim', 'ref.mp4', 'dist.mp4');
    const lavfi = args[args.indexOf('-lavfi') + 1];
    expect(lavfi).toBe('[1:v][0:v]scale2ref[dist][ref];[dist][ref]ssim');
  });
  it('orders reference before distorted as -i inputs', () => {
    const args = buildQualityArgs('psnr', 'ref.mp4', 'dist.mp4');
    const firstI = args.indexOf('-i');
    expect(args[firstI + 1]).toBe('ref.mp4');
    expect(args[args.indexOf('-i', firstI + 1) + 1]).toBe('dist.mp4');
  });
  it('discards output to null muxer', () => {
    const args = buildQualityArgs('psnr', 'ref.mp4', 'dist.mp4');
    expect(args[args.indexOf('-f') + 1]).toBe('null');
  });
});

describe('video-quality-metrics — parseQualityMetrics()', () => {
  it('rejects pathological incomplete metric lines in under one second', () => {
    const input = 'SSIM '.repeat(20_000);
    const start = performance.now();
    const result = parseQualityMetrics(input);

    expect(result).toEqual({ psnr: null, ssim: null });
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it('parses combined psnr + ssim log', () => {
    const r = parseQualityMetrics(`${PSNR_LINE}\n${SSIM_LINE}`);
    expect(r.ssim).toEqual({ all: 0.989, y: 0.987, u: 0.991, v: 0.992 });
    expect(r.psnr).toEqual({ average: 43.4, y: 42.5, u: 45.1, v: 46.0 });
  });
  it('keeps uppercase SSIM and lowercase PSNR channels distinct', () => {
    const r = parseQualityMetrics(`${PSNR_LINE}\n${SSIM_LINE}`);
    expect(r.ssim?.y).toBe(0.987);
    expect(r.psnr?.y).toBe(42.5);
  });
  it('maps inf (identical frames) to Infinity', () => {
    const inf = '[Parsed_psnr_0 @ 0x] PSNR y:inf u:inf v:inf average:inf min:inf max:inf';
    expect(parseQualityMetrics(inf).psnr?.average).toBe(Infinity);
  });
  it('returns null for a metric absent from the log', () => {
    expect(parseQualityMetrics(PSNR_LINE).ssim).toBeNull();
    expect(parseQualityMetrics(SSIM_LINE).psnr).toBeNull();
  });
});
