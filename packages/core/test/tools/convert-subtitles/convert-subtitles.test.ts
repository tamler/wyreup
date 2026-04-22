/**
 * convert-subtitles tests
 *
 * 1. Metadata — always run.
 * 2. detectSubtitleFormat — pure function, always run.
 * 3. convertSrtToVtt / convertVttToSrt — pure functions, always run.
 * 4. run() integration — always run (pure JS, no ffmpeg.wasm needed).
 */

import { describe, it, expect } from 'vitest';
import {
  convertSubtitles,
  defaultConvertSubtitlesParams,
  detectSubtitleFormat,
  convertSrtToVtt,
  convertVttToSrt,
} from '../../../src/tools/convert-subtitles/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:06,000
How are you?
`;

const SAMPLE_VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello world

00:00:04.000 --> 00:00:06.000
How are you?
`;

describe('convert-subtitles — metadata', () => {
  it('has id "convert-subtitles"', () => expect(convertSubtitles.id).toBe('convert-subtitles'));
  it('category is "media"', () => expect(convertSubtitles.category).toBe('media'));
  it('installGroup is "ffmpeg"', () => expect(convertSubtitles.installGroup).toBe('ffmpeg'));
  it('cost is "free"', () => expect(convertSubtitles.cost).toBe('free'));
  it('batchable is false', () => expect(convertSubtitles.batchable).toBe(false));
  it('defaults to srt output', () => expect(defaultConvertSubtitlesParams.to).toBe('srt'));
});

describe('convert-subtitles — detectSubtitleFormat()', () => {
  it('detects VTT by WEBVTT header', () => {
    expect(detectSubtitleFormat('WEBVTT\n\n00:00:01.000')).toBe('vtt');
  });

  it('detects SRT by numeric index', () => {
    expect(detectSubtitleFormat(SAMPLE_SRT)).toBe('srt');
  });

  it('returns null for unknown format', () => {
    expect(detectSubtitleFormat('not a subtitle file')).toBeNull();
  });
});

describe('convert-subtitles — convertSrtToVtt()', () => {
  it('output starts with WEBVTT', () => {
    const result = convertSrtToVtt(SAMPLE_SRT);
    expect(result.trimStart().startsWith('WEBVTT')).toBe(true);
  });

  it('uses dot separator in timestamps', () => {
    const result = convertSrtToVtt(SAMPLE_SRT);
    expect(result).toContain('00:00:01.000');
  });

  it('preserves subtitle text', () => {
    const result = convertSrtToVtt(SAMPLE_SRT);
    expect(result).toContain('Hello world');
    expect(result).toContain('How are you?');
  });

  it('applies time shift', () => {
    const result = convertSrtToVtt(SAMPLE_SRT, 2000); // +2 seconds
    expect(result).toContain('00:00:03.000');
  });
});

describe('convert-subtitles — convertVttToSrt()', () => {
  it('output contains numeric index', () => {
    const result = convertVttToSrt(SAMPLE_VTT);
    expect(result).toMatch(/^1\s*$/m);
  });

  it('uses comma separator in timestamps', () => {
    const result = convertVttToSrt(SAMPLE_VTT);
    expect(result).toContain('00:00:01,000');
  });

  it('preserves subtitle text', () => {
    const result = convertVttToSrt(SAMPLE_VTT);
    expect(result).toContain('Hello world');
  });

  it('applies time shift in ms', () => {
    const result = convertVttToSrt(SAMPLE_VTT, 1000); // +1 second
    expect(result).toContain('00:00:02,000');
  });
});

describe('convert-subtitles — run()', () => {
  it('converts SRT to VTT', async () => {
    const file = new File([SAMPLE_SRT], 'subs.srt', { type: 'text/plain' });
    const result = await convertSubtitles.run([file], { to: 'vtt' }, makeCtx()) as Blob[];
    expect(result).toHaveLength(1);
    const text = await result[0]!.text();
    expect(text.trimStart().startsWith('WEBVTT')).toBe(true);
  });

  it('converts VTT to SRT', async () => {
    const file = new File([SAMPLE_VTT], 'subs.vtt', { type: 'text/vtt' });
    const result = await convertSubtitles.run([file], { to: 'srt' }, makeCtx()) as Blob[];
    const text = await result[0]!.text();
    expect(text).toContain('00:00:01,000');
  });

  it('throws for unrecognized format', async () => {
    const file = new File(['not a sub file'], 'subs.txt', { type: 'text/plain' });
    await expect(
      convertSubtitles.run([file], { to: 'srt' }, makeCtx()),
    ).rejects.toThrow(/detect/i);
  });
});
