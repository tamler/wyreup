/**
 * video-speed tests
 *
 * 1. Metadata — always run.
 * 2. buildAtempoChain, buildSpeedArgs — pure functions, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoSpeed,
  defaultVideoSpeedParams,
  buildAtempoChain,
  buildSpeedArgs,
} from '../../../src/tools/video-speed/index.js';

describe('video-speed — metadata', () => {
  it('has id "video-speed"', () => expect(videoSpeed.id).toBe('video-speed'));
  it('category is "media"', () => expect(videoSpeed.category).toBe('media'));
  it('accepts video/*', () => expect(videoSpeed.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(videoSpeed.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(videoSpeed.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoSpeed.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoSpeed.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoSpeed.cost).toBe('free'));
  it('batchable is false', () => expect(videoSpeed.batchable).toBe(false));
  it('defaults speed is 1.0', () => expect(defaultVideoSpeedParams.speed).toBe(1.0));
  it('defaults preserveAudioPitch is true', () => expect(defaultVideoSpeedParams.preserveAudioPitch).toBe(true));
  it('defaults crf is 23', () => expect(defaultVideoSpeedParams.crf).toBe(23));
});

describe('video-speed — buildAtempoChain()', () => {
  it('single atempo for normal range 2.0', () => {
    expect(buildAtempoChain(2.0)).toBe('atempo=2');
  });

  it('single atempo for 0.5', () => {
    expect(buildAtempoChain(0.5)).toBe('atempo=0.5');
  });

  it('chains multiple atempo for speed 0.25 (below 0.5)', () => {
    const chain = buildAtempoChain(0.25);
    // Should contain two atempo filters chained
    expect(chain.split(',').length).toBeGreaterThanOrEqual(2);
    expect(chain).toContain('atempo=0.5');
  });

  it('single atempo for 1.5', () => {
    expect(buildAtempoChain(1.5)).toBe('atempo=1.5');
  });
});

describe('video-speed — buildSpeedArgs()', () => {
  it('includes setpts filter for video', () => {
    const args = buildSpeedArgs('in.mp4', 'out.mp4', { speed: 2.0, preserveAudioPitch: true });
    const vfIdx = args.indexOf('-filter:v');
    expect(vfIdx).not.toBe(-1);
    expect(args[vfIdx + 1]).toContain('setpts');
  });

  it('setpts factor is inverse of speed', () => {
    const args = buildSpeedArgs('in.mp4', 'out.mp4', { speed: 2.0, preserveAudioPitch: true });
    const vfIdx = args.indexOf('-filter:v');
    const filter = args[vfIdx + 1] ?? '';
    // For speed 2.0, factor should be 0.5
    expect(filter).toContain('0.5');
  });

  it('uses atempo for audio when preserveAudioPitch=true', () => {
    const args = buildSpeedArgs('in.mp4', 'out.mp4', { speed: 1.5, preserveAudioPitch: true });
    const afIdx = args.indexOf('-filter:a');
    const filter = args[afIdx + 1] ?? '';
    expect(filter).toContain('atempo');
  });

  it('uses asetrate when preserveAudioPitch=false', () => {
    const args = buildSpeedArgs('in.mp4', 'out.mp4', { speed: 2.0, preserveAudioPitch: false });
    const afIdx = args.indexOf('-filter:a');
    const filter = args[afIdx + 1] ?? '';
    expect(filter).toContain('asetrate');
  });

  it('includes -crf', () => {
    const args = buildSpeedArgs('in.mp4', 'out.mp4', { speed: 1.0, crf: 28 });
    expect(args).toContain('-crf');
    expect(args).toContain('28');
  });

  it('output is last arg', () => {
    const args = buildSpeedArgs('in.mp4', 'out.mp4', { speed: 1.0 });
    expect(args[args.length - 1]).toBe('out.mp4');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
