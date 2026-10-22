import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  createMp3Decoder,
  decodeMp3Mono,
  type PitchAudioContext,
} from '../../src/utilities/midi-audio.js';
import { preflightMp3 } from '../../src/utilities/midi-pitch.js';

const fixture = async () =>
  new Uint8Array(
    await readFile(new URL('../fixtures/catalog-files/melody-220-440.mp3', import.meta.url)),
  );
const frame = () => {
  const bytes = new Uint8Array(384);
  bytes.set([255, 251, 148, 192]);
  return bytes;
};
const decoded = (samples = new Float32Array(1152)) => ({
  sampleRate: 48000,
  numberOfChannels: 1,
  length: samples.length,
  duration: samples.length / 48000,
  getChannelData: () => samples,
});

describe('owned MP3 native decode', () => {
  it('preflights the actual original MP3 fixture', async () => {
    const shape = preflightMp3(await fixture(), 48000);
    expect(shape.sampleRate).toBe(48000);
    expect(shape.channels).toBe(1);
    expect(shape.duration).toBeGreaterThan(2);
    expect(shape.duration).toBeLessThan(2.1);
  });
  it('averages six actual samples into each 8 kHz mono sample and closes once', async () => {
    const samples = new Float32Array(1152);
    samples.set([1, 2, 3, 4, 5, 6]);
    const close = vi.fn(async () => {});
    const context = {
      sampleRate: 48000,
      close,
      decodeAudioData: vi.fn(() => Promise.resolve(decoded(samples))),
    };
    const result = await decodeMp3Mono(frame(), new AbortController().signal, () => context);
    expect(result.length).toBe(192);
    expect(result[0]).toBe(3.5);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported context rate before decoding and closes it', async () => {
    const context = {
      sampleRate: 44100,
      close: vi.fn(async () => {}),
      decodeAudioData: vi.fn(() => Promise.resolve(decoded())),
    };
    await expect(
      decodeMp3Mono(frame(), new AbortController().signal, () => context),
    ).rejects.toThrow('48 kHz');
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
  });
  it('rejects nonfinite and over-budget decoded samples without returning PCM', async () => {
    const samples = new Float32Array(1152);
    samples[10] = NaN;
    const context = {
      sampleRate: 48000,
      close: vi.fn(async () => {}),
      decodeAudioData: vi.fn(() => Promise.resolve(decoded(samples))),
    };
    await expect(
      decodeMp3Mono(frame(), new AbortController().signal, () => context),
    ).rejects.toThrow('sample');
    context.decodeAudioData.mockResolvedValueOnce(decoded(new Float32Array(4609)));
    await expect(
      decodeMp3Mono(frame(), new AbortController().signal, () => context),
    ).rejects.toThrow('limits');
    expect(context.close).toHaveBeenCalledTimes(2);
  });
  it('cancels promptly, keeps the decode reservation until settlement and discards late output', async () => {
    const decode = createMp3Decoder();
    let complete: (value: ReturnType<typeof decoded>) => void = () => {};
    const close = vi.fn(async () => {});
    const context: PitchAudioContext = {
      sampleRate: 48000,
      close,
      decodeAudioData: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    };
    const controller = new AbortController();
    const first = decode(frame(), controller.signal, () => context);
    controller.abort();
    await expect(first).rejects.toThrow('cancelled');
    await expect(decode(frame(), new AbortController().signal, () => context)).rejects.toThrow(
      'settling',
    );
    complete(decoded());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fresh = {
      sampleRate: 48000,
      close: vi.fn(async () => {}),
      decodeAudioData: () => Promise.resolve(decoded()),
    };
    expect(await decode(frame(), new AbortController().signal, () => fresh)).toHaveLength(192);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('does not create a context on preflight errors or pre-cancellation', async () => {
    const factory = vi.fn();
    expect(() => decodeMp3Mono(new Uint8Array(4), new AbortController().signal, factory)).toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(decodeMp3Mono(frame(), controller.signal, factory)).rejects.toThrow('cancelled');
    expect(factory).not.toHaveBeenCalled();
  });
});
