/**
 * replace-audio tests
 *
 * 1. Metadata — always run.
 * 2. pickVideoAudio, buildReplaceAudioArgs — pure functions, always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  replaceAudio,
  pickVideoAudio,
  buildReplaceAudioArgs,
} from '../../../src/tools/replace-audio/index.js';

describe('replace-audio — metadata', () => {
  it('has id "replace-audio"', () => expect(replaceAudio.id).toBe('replace-audio'));
  it('takes exactly two inputs', () => {
    expect(replaceAudio.input.min).toBe(2);
    expect(replaceAudio.input.max).toBe(2);
  });
  it('accepts video and audio', () => {
    expect(replaceAudio.input.accept).toContain('video/*');
    expect(replaceAudio.input.accept).toContain('audio/*');
  });
  it('output mime is video/mp4', () => expect(replaceAudio.output.mime).toBe('video/mp4'));
});

describe('replace-audio — pickVideoAudio()', () => {
  it('classifies [video, audio]', () => {
    const r = pickVideoAudio([{ type: 'video/mp4' }, { type: 'audio/mpeg' }]);
    expect(r).toEqual({ videoIndex: 0, audioIndex: 1 });
  });
  it('classifies reversed order [audio, video]', () => {
    const r = pickVideoAudio([{ type: 'audio/wav' }, { type: 'video/webm' }]);
    expect(r).toEqual({ videoIndex: 1, audioIndex: 0 });
  });
  it('throws when no audio', () => {
    expect(() => pickVideoAudio([{ type: 'video/mp4' }, { type: 'video/webm' }])).toThrow(/audio/i);
  });
  it('throws when no video', () => {
    expect(() => pickVideoAudio([{ type: 'audio/mpeg' }, { type: 'audio/wav' }])).toThrow(/video/i);
  });
});

describe('replace-audio — buildReplaceAudioArgs()', () => {
  it('maps video from input 0 and audio from input 1', () => {
    const args = buildReplaceAudioArgs('video.mp4', 'audio.mp3', 'out.mp4');
    expect(args).toContain('0:v:0');
    expect(args).toContain('1:a:0');
  });
  it('copies video, re-encodes audio to aac', () => {
    const args = buildReplaceAudioArgs('video.mp4', 'audio.mp3', 'out.mp4');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
  });
  it('ends at the shortest stream', () => {
    expect(buildReplaceAudioArgs('v.mp4', 'a.mp3', 'out.mp4')).toContain('-shortest');
  });
  it('output is last arg', () => {
    expect(buildReplaceAudioArgs('v.mp4', 'a.mp3', 'out.mp4').at(-1)).toBe('out.mp4');
  });
});
