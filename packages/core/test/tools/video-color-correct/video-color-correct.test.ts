/**
 * video-color-correct tests
 *
 * 1. Metadata — always run.
 * 2. buildColorCorrectFilter — pure function, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoColorCorrect,
  defaultVideoColorCorrectParams,
  buildColorCorrectFilter,
} from '../../../src/tools/video-color-correct/index.js';

describe('video-color-correct — metadata', () => {
  it('has id "video-color-correct"', () => expect(videoColorCorrect.id).toBe('video-color-correct'));
  it('category is "media"', () => expect(videoColorCorrect.category).toBe('media'));
  it('accepts video/*', () => expect(videoColorCorrect.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(videoColorCorrect.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(videoColorCorrect.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoColorCorrect.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoColorCorrect.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoColorCorrect.cost).toBe('free'));
  it('batchable is false', () => expect(videoColorCorrect.batchable).toBe(false));
  it('defaults brightness is 0', () => expect(defaultVideoColorCorrectParams.brightness).toBe(0));
  it('defaults contrast is 1.0', () => expect(defaultVideoColorCorrectParams.contrast).toBe(1.0));
  it('defaults saturation is 1.0', () => expect(defaultVideoColorCorrectParams.saturation).toBe(1.0));
  it('defaults gamma is 1.0', () => expect(defaultVideoColorCorrectParams.gamma).toBe(1.0));
  it('defaults hueShift is 0', () => expect(defaultVideoColorCorrectParams.hueShift).toBe(0));
  it('defaults crf is 23', () => expect(defaultVideoColorCorrectParams.crf).toBe(23));
});

describe('video-color-correct — buildColorCorrectFilter()', () => {
  it('starts with eq filter', () => {
    const f = buildColorCorrectFilter({ brightness: 0, contrast: 1, saturation: 1, gamma: 1 });
    expect(f.startsWith('eq=')).toBe(true);
  });

  it('includes all eq params', () => {
    const f = buildColorCorrectFilter({ brightness: 0.1, contrast: 1.2, saturation: 1.5, gamma: 1.1 });
    expect(f).toContain('brightness=0.1');
    expect(f).toContain('contrast=1.2');
    expect(f).toContain('saturation=1.5');
    expect(f).toContain('gamma=1.1');
  });

  it('appends hue filter when hueShift != 0', () => {
    const f = buildColorCorrectFilter({ hueShift: 90 });
    expect(f).toContain(',hue=h=90');
  });

  it('no hue filter when hueShift is 0', () => {
    const f = buildColorCorrectFilter({ hueShift: 0 });
    expect(f).not.toContain('hue=');
  });

  it('uses defaults when params are omitted', () => {
    const f = buildColorCorrectFilter({});
    expect(f).toContain('brightness=0');
    expect(f).toContain('contrast=1');
    expect(f).toContain('saturation=1');
    expect(f).toContain('gamma=1');
    expect(f).not.toContain('hue=');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
