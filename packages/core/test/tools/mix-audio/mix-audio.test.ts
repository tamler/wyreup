import { describe, it, expect } from 'vitest';
import { mixAudio, pickVideoAudio, buildMixAudioArgs } from '../../../src/tools/mix-audio/index.js';

describe('mix-audio', () => {
  it('id + two inputs', () => {
    expect(mixAudio.id).toBe('mix-audio');
    expect(mixAudio.input.min).toBe(2);
    expect(mixAudio.input.max).toBe(2);
  });
  it('classifies video + audio in any order', () => {
    expect(pickVideoAudio([{ type: 'audio/mpeg' }, { type: 'video/mp4' }]))
      .toEqual({ videoIndex: 1, audioIndex: 0 });
  });
  it('throws without an audio file', () => {
    expect(() => pickVideoAudio([{ type: 'video/mp4' }, { type: 'video/webm' }])).toThrow(/audio/i);
  });
  it('amix blends ducked music under the video audio', () => {
    const args = buildMixAudioArgs('video.mp4', 'music.mp3', 'out.mp4', 0.3);
    const f = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(f).toContain('volume=0.3');
    expect(f).toContain('amix=inputs=2');
    expect(args).toContain('0:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
  });
});
