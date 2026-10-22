import { preflightMp3 } from './midi-pitch.js';

interface DecodedAudio {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  duration: number;
  getChannelData(index: number): Float32Array;
}
export interface PitchAudioContext {
  sampleRate: number;
  decodeAudioData(bytes: ArrayBuffer): Promise<DecodedAudio>;
  close(): Promise<void>;
}

const cancelled = () => new Error('Audio conversion cancelled.');

export type Mp3Decoder = (
  bytes: Uint8Array,
  signal: AbortSignal,
  factory?: () => PitchAudioContext,
) => Promise<Float32Array>;

export function decodeMp3Mono(
  bytes: Uint8Array,
  signal: AbortSignal,
  factory?: () => PitchAudioContext,
): Promise<Float32Array> {
  return createMp3Decoder()(bytes, signal, factory);
}

/** The native decoder remains owned until it settles, including after cancellation. */
export function createMp3Decoder(): Mp3Decoder {
  let decodeActive = false;
  return function decode(
    bytes: Uint8Array,
    signal: AbortSignal,
    factory: () => PitchAudioContext = () => new AudioContext({ sampleRate: 48000 }),
  ): Promise<Float32Array> {
    if (signal.aborted) return Promise.reject(cancelled());
    if (decodeActive)
      return Promise.reject(new Error('The previous audio decode is still settling.'));
    preflightMp3(bytes, 48000);
    decodeActive = true;
    let context: PitchAudioContext | undefined;
    let closing: Promise<void> | undefined;
    const close = () => {
      if (!context) return Promise.resolve();
      if (!closing) {
        try {
          closing = context.close();
        } catch (error) {
          closing = Promise.reject(
            error instanceof Error ? error : new Error('Could not close the owned audio decoder.'),
          );
        }
        void closing.catch(() => {});
      }
      return closing;
    };
    let rejectAbort: (error: Error) => void = () => {};
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => {
      rejectAbort(cancelled());
      void close().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const operation = (async () => {
      try {
        context = factory();
        if (context.sampleRate !== 48000)
          throw new Error('This browser does not support the required 48 kHz audio decoder.');
        const shape = preflightMp3(bytes, context.sampleRate);
        if (signal.aborted) throw cancelled();
        const decoded = await context.decodeAudioData(new Uint8Array(bytes).buffer);
        if (signal.aborted) throw cancelled();
        if (
          decoded.sampleRate !== context.sampleRate ||
          decoded.numberOfChannels !== shape.channels ||
          !Number.isInteger(decoded.length) ||
          decoded.length < 1 ||
          decoded.length * decoded.numberOfChannels > shape.maximumDecodedSamples ||
          !Number.isFinite(decoded.duration) ||
          decoded.duration <= 0 ||
          decoded.duration > 120 ||
          Math.abs(decoded.duration - decoded.length / decoded.sampleRate) > 1 / decoded.sampleRate
        )
          throw new Error(
            'Decoded audio exceeds the supported duration, channel or sample limits.',
          );
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
          decoded.getChannelData(index),
        );
        if (
          channels.some(
            (channel) => !(channel instanceof Float32Array) || channel.length !== decoded.length,
          )
        )
          throw new Error('Invalid decoded audio samples.');
        const length = Math.ceil(decoded.length / 6);
        if (length > 960000) throw new Error('Decoded audio exceeds 120 seconds.');
        const mono = new Float32Array(length);
        for (let index = 0; index < decoded.length; index += 6) {
          if ((index & 4095) === 0 && signal.aborted) throw cancelled();
          let sum = 0;
          const end = Math.min(index + 6, decoded.length);
          for (let sample = index; sample < end; sample++) {
            for (const channel of channels) {
              const value = channel[sample]!;
              if (!Number.isFinite(value)) throw new Error('Invalid decoded audio sample.');
              sum += value;
            }
          }
          mono[index / 6] = sum / ((end - index) * channels.length);
        }
        return mono;
      } finally {
        try {
          await close();
        } finally {
          decodeActive = false;
          signal.removeEventListener('abort', onAbort);
        }
      }
    })();
    void operation.catch(() => {});
    return Promise.race([operation, cancellation]);
  };
}
