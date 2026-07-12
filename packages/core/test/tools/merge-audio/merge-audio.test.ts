import { describe, expect, it } from 'vitest';
import {
  buildMergeAudioArgs,
  defaultMergeAudioParams,
  mergeAudio,
} from '../../../src/tools/merge-audio/index.js';

describe('merge-audio — metadata', () => {
  it('describes an ffmpeg-backed audio tool', () => {
    expect(mergeAudio.id).toBe('merge-audio');
    expect(mergeAudio.slug).toBe('merge-audio');
    expect(mergeAudio.category).toBe('audio');
    expect(mergeAudio.categories).toEqual(['audio', 'media']);
    expect(mergeAudio.cost).toBe('free');
    expect(mergeAudio.installGroup).toBe('ffmpeg');
    expect(mergeAudio.installSize).toBe(30_000_000);
    expect(mergeAudio.llmDescription).toBeTruthy();
  });

  it('accepts at least two audio inputs', () => {
    expect(mergeAudio.input.accept).toEqual(['audio/*']);
    expect(mergeAudio.input.min).toBe(2);
  });

  it('defaults to MP3', () => {
    expect(defaultMergeAudioParams).toEqual({ format: 'mp3' });
  });

  it('paramSchema covers every defaults key with labels and help', () => {
    expect(Object.keys(mergeAudio.paramSchema ?? {}).sort()).toEqual(
      Object.keys(defaultMergeAudioParams).sort(),
    );
    for (const schema of Object.values(mergeAudio.paramSchema ?? {})) {
      expect(schema?.label).toBeTruthy();
      expect(schema?.help).toBeTruthy();
    }
  });
});

describe('merge-audio — buildMergeAudioArgs()', () => {
  it('builds exact MP3 args for two inputs', () => {
    expect(buildMergeAudioArgs(2, 'mp3')).toEqual([
      '-i',
      'input0',
      '-i',
      'input1',
      '-filter_complex',
      'concat=n=2:v=0:a=1[out]',
      '-map',
      '[out]',
      '-c:a',
      'libmp3lame',
      'output.mp3',
    ]);
  });

  it('builds exact WAV args for three inputs', () => {
    expect(buildMergeAudioArgs(3, 'wav')).toEqual([
      '-i',
      'input0',
      '-i',
      'input1',
      '-i',
      'input2',
      '-filter_complex',
      'concat=n=3:v=0:a=1[out]',
      '-map',
      '[out]',
      '-c:a',
      'pcm_s16le',
      'output.wav',
    ]);
  });

  it('builds exact M4A args with AAC', () => {
    expect(buildMergeAudioArgs(3, 'm4a')).toEqual([
      '-i',
      'input0',
      '-i',
      'input1',
      '-i',
      'input2',
      '-filter_complex',
      'concat=n=3:v=0:a=1[out]',
      '-map',
      '[out]',
      '-c:a',
      'aac',
      'output.m4a',
    ]);
  });
});
