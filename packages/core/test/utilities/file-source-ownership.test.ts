import { describe, expect, it, vi } from 'vitest';
import * as audio from '../../src/utilities/midi-audio.js';
import {
  decodeCanonicalCompositeInWorker,
  type PsdComposite,
} from '../../src/utilities/psd-composite.js';

function originalFrame(): Uint8Array {
  const bytes = new Uint8Array(384);
  bytes.set([255, 251, 148, 192]);
  return bytes;
}

function decoded(samples = new Float32Array(1152)) {
  return {
    sampleRate: 48000,
    numberOfChannels: 1,
    length: samples.length,
    duration: samples.length / 48000,
    getChannelData: () => samples,
  };
}

function pendingContext() {
  let settle: (value: ReturnType<typeof decoded>) => void = () => {};
  const context = {
    sampleRate: 48000,
    decodeAudioData: vi.fn(
      () =>
        new Promise<ReturnType<typeof decoded>>((resolve) => {
          settle = resolve;
        }),
    ),
    close: vi.fn(async () => {}),
  };
  return { context, settle: () => settle(decoded()) };
}

function successfulContext() {
  const samples = new Float32Array(1152);
  samples.set([1, 2, 3, 4, 5, 6]);
  return {
    sampleRate: 48000,
    decodeAudioData: vi.fn(() => Promise.resolve(decoded(samples))),
    close: vi.fn(async () => {}),
  };
}

async function allowNativeSettlement(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('file source correction ownership contracts', () => {
  it('allows an independent convenience decode while a cancelled native decode remains pending', async () => {
    const pending = pendingContext();
    const secondContext = successfulContext();
    const secondFactory = vi.fn(() => secondContext);
    const controller = new AbortController();
    const first = audio.decodeMp3Mono(originalFrame(), controller.signal, () => pending.context);
    controller.abort();
    try {
      await expect(first).rejects.toThrow('cancelled');
      expect(pending.context.close).toHaveBeenCalledTimes(1);
      const second = await audio.decodeMp3Mono(
        originalFrame(),
        new AbortController().signal,
        secondFactory,
      );
      expect(secondFactory).toHaveBeenCalledTimes(1);
      expect(secondContext.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(second).toHaveLength(192);
      expect(second[0]).toBe(3.5);
      expect(secondContext.close).toHaveBeenCalledTimes(1);
    } finally {
      pending.settle();
      await allowNativeSettlement();
    }
    expect(pending.context.close).toHaveBeenCalledTimes(1);
  });

  it('reserves only the same decoder owner until settlement and permits a different owner', async () => {
    const create = Reflect.get(audio, 'createMp3Decoder') as unknown;
    expect(typeof create).toBe('function');
    if (typeof create !== 'function') throw new Error('createMp3Decoder ownership API missing.');
    const createOwner = create as () => typeof audio.decodeMp3Mono;
    const firstOwner = createOwner();
    const secondOwner = createOwner();
    const pending = pendingContext();
    const forbiddenFactory = vi.fn(() => successfulContext());
    const independentContext = successfulContext();
    const controller = new AbortController();
    const first = firstOwner(originalFrame(), controller.signal, () => pending.context);
    controller.abort();
    try {
      await expect(first).rejects.toThrow('cancelled');
      await expect(
        firstOwner(originalFrame(), new AbortController().signal, forbiddenFactory),
      ).rejects.toThrow('settling');
      expect(forbiddenFactory).not.toHaveBeenCalled();
      const independent = await secondOwner(
        originalFrame(),
        new AbortController().signal,
        () => independentContext,
      );
      expect(independent[0]).toBe(3.5);
      expect(independentContext.close).toHaveBeenCalledTimes(1);
    } finally {
      pending.settle();
      await allowNativeSettlement();
    }
    const freshContext = successfulContext();
    expect(
      await firstOwner(originalFrame(), new AbortController().signal, () => freshContext),
    ).toHaveLength(192);
    expect(freshContext.close).toHaveBeenCalledTimes(1);
    expect(pending.context.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['opaque', [255, 0, 0, 255, 0, 255, 0, 255]],
    ['explicit-channel', [7, 11, 13, 0, 17, 19, 23, 128]],
    ['merged-transparency', [31, 37, 41, 128, 43, 47, 53, 255]],
  ] as const)(
    'uses actual ag-psd decoding in the original validated %s RGBA target',
    async (alphaSource, pixels) => {
      const rgba = new Uint8ClampedArray(pixels);
      const expected = [...pixels];
      const composite: PsdComposite = { width: 2, height: 1, rgba, alphaSource };
      const result = await decodeCanonicalCompositeInWorker(composite);
      expect([...result.rgba]).toEqual(expected);
      expect([...rgba]).toEqual(expected);
      expect(result.width).toBe(2);
      expect(result.height).toBe(1);
      expect(result.alphaSource).toBe(alphaSource);
      expect(result.rgba).toBe(rgba);
      expect(result.rgba.buffer).toBe(rgba.buffer);
    },
  );

  it.each([
    { width: 0, height: 1, length: 4 },
    { width: 1, height: 0, length: 4 },
    { width: 8193, height: 1, length: 4 },
    { width: 8000, height: 2001, length: 4 },
    { width: 2, height: 1, length: 4 },
  ])(
    'rejects malformed or over-cap PSD target $width × $height / $length bytes',
    async ({ width, height, length }) => {
      const composite: PsdComposite = {
        width,
        height,
        rgba: new Uint8ClampedArray(length),
        alphaSource: 'opaque',
      };
      await expect(decodeCanonicalCompositeInWorker(composite)).rejects.toThrow(
        /Invalid bounded RGBA|budget|dimensions/i,
      );
    },
  );
});
