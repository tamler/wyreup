import { describe, expect, it } from 'vitest';
import {
  audioSpeed,
  buildAudioSpeedArgs,
  decomposeTempo,
  defaultAudioSpeedParams,
} from '../../../src/tools/audio-speed/index.js';

describe('audio-speed — metadata', () => {
  it('describes an ffmpeg-backed audio tool', () => {
    expect(audioSpeed.id).toBe('audio-speed');
    expect(audioSpeed.slug).toBe('audio-speed');
    expect(audioSpeed.category).toBe('audio');
    expect(audioSpeed.categories).toEqual(['audio', 'media']);
    expect(audioSpeed.cost).toBe('free');
    expect(audioSpeed.installGroup).toBe('ffmpeg');
    expect(audioSpeed.installSize).toBe(30_000_000);
    expect(audioSpeed.llmDescription).toBeTruthy();
  });

  it('accepts exactly one audio input and returns MP3', () => {
    expect(audioSpeed.input.accept).toEqual(['audio/*']);
    expect(audioSpeed.input.min).toBe(1);
    expect(audioSpeed.input.max).toBe(1);
    expect(audioSpeed.output.mime).toBe('audio/mpeg');
  });

  it('has the specified defaults', () => {
    expect(defaultAudioSpeedParams).toEqual({ speed: 1.5, preservePitch: true });
  });

  it('paramSchema covers every defaults key with labels and help', () => {
    expect(Object.keys(audioSpeed.paramSchema ?? {}).sort()).toEqual(
      Object.keys(defaultAudioSpeedParams).sort(),
    );
    for (const schema of Object.values(audioSpeed.paramSchema ?? {})) {
      expect(schema?.label).toBeTruthy();
      expect(schema?.help).toBeTruthy();
    }
  });

  it('defines the speed range and step', () => {
    expect(audioSpeed.paramSchema?.speed).toMatchObject({
      type: 'range',
      min: 0.25,
      max: 4,
      step: 0.05,
    });
  });
});

describe('audio-speed — decomposeTempo()', () => {
  it.each([
    [3, [2, 1.5]],
    [0.3, [0.5, 0.6]],
    [1, [1]],
    [0.25, [0.5, 0.5]],
    [4, [2, 2]],
  ])('decomposes %s into valid atempo stages', (speed, expected) => {
    expect(decomposeTempo(speed)).toEqual(expected);
  });
});

describe('audio-speed — buildAudioSpeedArgs()', () => {
  it('builds exact pitch-preserving args for 3x speed', () => {
    expect(buildAudioSpeedArgs(3, true)).toEqual([
      '-i',
      'input',
      '-filter:a',
      'atempo=2,atempo=1.5',
      '-c:a',
      'libmp3lame',
      'output.mp3',
    ]);
  });

  it('builds exact pitch-preserving args for 0.3x speed', () => {
    expect(buildAudioSpeedArgs(0.3, true)).toEqual([
      '-i',
      'input',
      '-filter:a',
      'atempo=0.5,atempo=0.6',
      '-c:a',
      'libmp3lame',
      'output.mp3',
    ]);
  });

  it('builds exact tape-style args', () => {
    expect(buildAudioSpeedArgs(1.5, false)).toEqual([
      '-i',
      'input',
      '-filter:a',
      'asetrate=44100*1.5,aresample=44100',
      '-c:a',
      'libmp3lame',
      'output.mp3',
    ]);
  });
});
