/**
 * trim-media tests
 *
 * 1. Metadata — always run.
 * 2. run() param validation (no ffmpeg needed) — always run.
 * 3. Full run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import { trimMedia, defaultTrimMediaParams } from '../../../src/tools/trim-media/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('trim-media — metadata', () => {
  it('has id "trim-media"', () => expect(trimMedia.id).toBe('trim-media'));
  it('category is "media"', () => expect(trimMedia.category).toBe('media'));
  it('accepts audio/* and video/*', () => {
    expect(trimMedia.input.accept).toContain('audio/*');
    expect(trimMedia.input.accept).toContain('video/*');
  });
  it('installSize is 30 MB', () => expect(trimMedia.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(trimMedia.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(trimMedia.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(trimMedia.cost).toBe('free'));
  it('batchable is false', () => expect(trimMedia.batchable).toBe(false));
  it('no requires field', () => expect(trimMedia.requires).toBeUndefined());
  it('defaults start is 0', () => expect(defaultTrimMediaParams.start).toBe(0));
  it('defaults end is 30', () => expect(defaultTrimMediaParams.end).toBe(30));
});

describe('trim-media — run() param validation', () => {
  it('throws when start < 0', async () => {
    const file = new File(['data'], 'test.mp3', { type: 'audio/mpeg' });
    await expect(
      trimMedia.run([file], { start: -1, end: 10 }, makeCtx()),
    ).rejects.toThrow(/start must be >= 0/);
  });

  it('throws when end <= start', async () => {
    const file = new File(['data'], 'test.mp3', { type: 'audio/mpeg' });
    await expect(
      trimMedia.run([file], { start: 10, end: 5 }, makeCtx()),
    ).rejects.toThrow(/end must be greater than start/);
  });

  it('throws when start === end', async () => {
    const file = new File(['data'], 'test.mp3', { type: 'audio/mpeg' });
    await expect(
      trimMedia.run([file], { start: 5, end: 5 }, makeCtx()),
    ).rejects.toThrow(/end must be greater than start/);
  });
});

// Full run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
