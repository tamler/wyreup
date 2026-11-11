// Audio duration measured from the bytes, for hosted transcription.
//
// Whisper on Workers AI bills per audio minute, so the server must know the
// real duration before it reserves credits. A byte cap is not enough: a
// low-bitrate file can hold hours in 25 MB. This module accepts only
// formats whose decoded length follows from the payload itself, not from
// a header field an uploader could fake:
//   - WAV with PCM, float, A-law or mu-law samples: data bytes / byte rate,
//     with the header checked for internal consistency.
//   - MP3 (MPEG 1, 2 and 2.5, layers I to III): every frame is walked and
//     its fixed sample count summed. Bytes that are not frames (beyond the
//     ID3 tags and a short tail) are rejected, so nothing can hide audio.
// Other containers (M4A, AAC, OGG, WebM, FLAC) are refused; the error
// tells the user to convert to MP3 first.
//
// No imports: functions/ imports this file directly.

/** Longest audio a hosted transcription run accepts (cost model input). */
export const HOSTED_AUDIO_MAX_SECONDS = 45 * 60;

export interface MeasuredAudio {
  format: 'wav' | 'mp3';
  seconds: number;
}

export class AudioDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioDurationError';
  }
}

const UNSUPPORTED =
  'Hosted transcription accepts WAV or MP3 files only, so the audio length can be checked before any credits are used. Convert other formats (M4A, AAC, OGG, WebM, FLAC) to MP3 first, for example with the free Convert Audio tool.';

/** Measures duration in seconds. Throws AudioDurationError for anything it cannot verify. */
export function measureAudioDuration(bytes: Uint8Array): MeasuredAudio {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    return { format: 'wav', seconds: wavSeconds(bytes) };
  }
  if (looksLikeMp3(bytes)) return { format: 'mp3', seconds: mp3Seconds(bytes) };
  throw new AudioDurationError(UNSUPPORTED);
}

/** Measures and enforces HOSTED_AUDIO_MAX_SECONDS. */
export function assertHostedAudioDuration(bytes: Uint8Array): MeasuredAudio {
  const measured = measureAudioDuration(bytes);
  if (measured.seconds > HOSTED_AUDIO_MAX_SECONDS) {
    const minutes = Math.ceil(measured.seconds / 60);
    throw new AudioDurationError(
      `This audio is about ${minutes} minutes long. Hosted transcription takes up to ${HOSTED_AUDIO_MAX_SECONDS / 60} minutes per run; trim or split it first.`,
    );
  }
  return measured;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) +
    bytes[offset + 3]! * 0x1000000
  );
}

// ── WAV ────────────────────────────────────────────────────────────────

const AMBIGUOUS_WAV =
  'This WAV file has more than one format or data section, so its length cannot be checked. Re-export it as a plain WAV or MP3 first.';

function wavSeconds(bytes: Uint8Array): number {
  let byteRate = 0;
  let dataBytes = 0;
  let sawData = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = ascii(bytes, offset, 4);
    const declared = u32(bytes, offset + 4);
    const body = offset + 8;
    // A streaming writer may leave the size at 0 or 0xFFFFFFFF; a truncated
    // file may declare more than it holds. Either way the decoder reads what
    // is present, so count the bytes actually there.
    const available = bytes.length - body;
    const size =
      declared === 0 || declared === 0xffffffff ? available : Math.min(declared, available);
    if (id === 'fmt ') {
      // Decoders disagree on which of several format chunks wins (FFmpeg
      // uses the first), so a second one could make a 50-minute file look
      // like 2 seconds here. Only one format chunk, before the data, is valid.
      if (byteRate || sawData) throw new AudioDurationError(AMBIGUOUS_WAV);
      if (size < 16) throw new AudioDurationError('This WAV file has an invalid format header.');
      let format = u16(bytes, body);
      const channels = u16(bytes, body + 2);
      const sampleRate = u32(bytes, body + 4);
      const rate = u32(bytes, body + 8);
      const blockAlign = u16(bytes, body + 12);
      const bits = u16(bytes, body + 14);
      if (format === 0xfffe) {
        if (size < 26) throw new AudioDurationError('This WAV file has an invalid format header.');
        format = u16(bytes, body + 24);
      }
      const validFormat =
        ((format === 1 || format === 3) && [8, 16, 24, 32, 64].includes(bits)) ||
        ((format === 6 || format === 7) && bits === 8);
      if (
        !validFormat ||
        channels < 1 ||
        channels > 8 ||
        sampleRate < 8_000 ||
        sampleRate > 192_000 ||
        blockAlign !== (channels * bits) / 8 ||
        rate !== sampleRate * blockAlign
      ) {
        throw new AudioDurationError(
          'This WAV file uses a compressed or inconsistent format. Convert it to MP3 or plain PCM WAV first.',
        );
      }
      byteRate = rate;
    } else if (id === 'data') {
      if (!byteRate)
        throw new AudioDurationError('This WAV file has audio data before its format header.');
      // Likewise only one data chunk: decoders differ on whether they read
      // past the first.
      if (sawData) throw new AudioDurationError(AMBIGUOUS_WAV);
      dataBytes += size;
      sawData = true;
    }
    offset = body + size + (size % 2);
  }
  if (!byteRate || !sawData) throw new AudioDurationError('This WAV file has no audio data.');
  return dataBytes / byteRate;
}

// ── MP3 ────────────────────────────────────────────────────────────────

const BITRATES: Record<string, readonly number[]> = {
  // [version][layer] -> kbps by index 1..14
  '1-1': [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, readonly number[]> = {
  1: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  25: [11_025, 12_000, 8_000],
};
/** Non-frame bytes tolerated after the last frame (padding, a damaged tail). */
const MP3_MAX_TAIL_BYTES = 2_048;
/** Lowest MP3 bitrate (8 kbps) in bytes per second, to price a tolerated tail. */
const MP3_MIN_BYTES_PER_SECOND = 1_000;

interface Mp3Frame {
  length: number;
  samples: number;
  sampleRate: number;
}

function parseFrame(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.length) return null;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  if (versionBits === 1 || layerBits === 0) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const layer = 4 - layerBits; // 3 -> I, 2 -> II, 1 -> III
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const table = BITRATES[`${version === 1 ? 1 : 2}-${layer}`]!;
  const bitrate = table[bitrateIndex - 1]! * 1000;
  const sampleRate = SAMPLE_RATES[version]![rateIndex]!;
  const padding = (b2 >> 1) & 1;
  let length: number;
  let samples: number;
  if (layer === 1) {
    length = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
    samples = 384;
  } else if (layer === 2 || version === 1) {
    length = Math.floor((144 * bitrate) / sampleRate) + padding;
    samples = 1152;
  } else {
    length = Math.floor((72 * bitrate) / sampleRate) + padding;
    samples = 576;
  }
  return length >= 4 ? { length, samples, sampleRate } : null;
}

function id3v2End(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') return 0;
  let size = 0;
  for (let i = 6; i < 10; i++) {
    if (bytes[i]! >= 0x80) throw new AudioDurationError('This MP3 has an invalid ID3 tag.');
    size = size * 128 + bytes[i]!;
  }
  const footer = bytes[3] === 4 && (bytes[5]! & 0x10) !== 0;
  return 10 + size + (footer ? 10 : 0);
}

function looksLikeMp3(bytes: Uint8Array): boolean {
  let start: number;
  try {
    start = id3v2End(bytes);
  } catch {
    return ascii(bytes, 0, 3) === 'ID3';
  }
  return start > 0 || parseFrame(bytes, 0) !== null;
}

function mp3Seconds(bytes: Uint8Array): number {
  const start = id3v2End(bytes);
  let end = bytes.length;
  if (end - start >= 128 && ascii(bytes, end - 128, 3) === 'TAG') end -= 128;
  if (start >= end) throw new AudioDurationError('This MP3 has no audio frames.');
  let seconds = 0;
  let frames = 0;
  let offset = start;
  while (offset < end) {
    const frame = parseFrame(bytes, offset);
    if (!frame) break;
    seconds += frame.samples / frame.sampleRate;
    frames++;
    offset += frame.length;
  }
  if (frames === 0) throw new AudioDurationError('This MP3 has no audio frames.');
  // offset can pass `end` when the last frame is cut short; that is fine.
  const tail = Math.max(0, end - offset);
  if (tail > MP3_MAX_TAIL_BYTES) {
    throw new AudioDurationError(
      'This MP3 contains data that is not audio frames, so its length cannot be checked. Re-export it as a plain MP3 first.',
    );
  }
  return seconds + tail / MP3_MIN_BYTES_PER_SECOND;
}
