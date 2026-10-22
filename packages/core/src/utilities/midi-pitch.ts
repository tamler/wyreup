import {
  cloneUtilityJson,
  UtilityInputError,
  validateUtilityParams,
  type UtilityParams,
} from './common.js';

export interface Mp3Shape {
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
  frameCount: number;
  duration: number;
  maximumDecodedSamples: number;
}
export interface PitchNote {
  id: string;
  note: number;
  start: number;
  end: number;
  frequency: number;
  confidence: number;
  velocity: number;
}
export interface PitchReport {
  notes: PitchNote[];
  duration: number;
  voicedFrames: number;
  unvoicedFrames: number;
  analysisRate: 8000;
  status: 'notes' | 'no-notes';
}

export const defaultPitchParams = {
  tempo: 120,
  minHz: 80,
  maxHz: 1000,
  noiseGate: 0.01,
  confidence: 0.85,
  minDuration: 0.08,
  mergeGap: 0.05,
  acceptedNoteIds: null,
};
export const pitchSchema = {
  tempo: { type: 'number' as const, label: 'Tempo (BPM)', min: 30, max: 300, step: 1 },
  minHz: { type: 'number' as const, label: 'Lowest pitch (Hz)', min: 80, max: 1000 },
  maxHz: { type: 'number' as const, label: 'Highest pitch (Hz)', min: 80, max: 1000 },
  noiseGate: { type: 'number' as const, label: 'RMS noise gate', min: 0, max: 1 },
  confidence: { type: 'number' as const, label: 'Minimum confidence', min: 0.5, max: 0.99 },
  minDuration: {
    type: 'number' as const,
    label: 'Minimum note duration (seconds)',
    min: 0.02,
    max: 1,
  },
  mergeGap: { type: 'number' as const, label: 'Merge same-note gaps (seconds)', min: 0, max: 0.25 },
  acceptedNoteIds: {
    type: 'json' as const,
    label: 'Accepted note IDs',
    help: 'Null accepts all computed notes; an array selects only IDs from this analysis.',
  },
};

function fail(field: string, message: string): never {
  throw new UtilityInputError(field, 'bounds', message);
}
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Pitch analysis cancelled.');
}

function pitchSelection(accepted: unknown): string[] | null {
  const copied = cloneUtilityJson(accepted, 'acceptedNoteIds');
  if (copied === null) return null;
  if (
    !Array.isArray(copied) ||
    copied.length > 20000 ||
    copied.some((id) => typeof id !== 'string') ||
    new Set(copied).size !== copied.length
  )
    fail('acceptedNoteIds', 'Select unique IDs from this analysis.');
  return copied as string[];
}

export function validatePitchParams(provided: UtilityParams): UtilityParams {
  const caller = cloneUtilityJson(provided, '$');
  if (caller === null || typeof caller !== 'object' || Array.isArray(caller))
    throw new UtilityInputError('$', 'type', 'Expected an object.');
  for (const key of Object.keys(caller)) {
    if (!Object.hasOwn(pitchSchema, key))
      throw new UtilityInputError(key, 'unknown', 'Unknown parameter.');
  }
  const numericDefaults = Object.create(null) as UtilityParams;
  const numericCaller = Object.create(null) as UtilityParams;
  const numericSchema = Object.create(null) as Record<
    string,
    typeof pitchSchema.tempo | typeof pitchSchema.minHz
  >;
  for (const key of [
    'tempo',
    'minHz',
    'maxHz',
    'noiseGate',
    'confidence',
    'minDuration',
    'mergeGap',
  ] as const) {
    numericDefaults[key] = defaultPitchParams[key];
    numericSchema[key] = pitchSchema[key];
    if (Object.hasOwn(caller, key)) numericCaller[key] = caller[key];
  }
  const params = validateUtilityParams(numericDefaults, numericSchema, numericCaller);
  params.acceptedNoteIds = pitchSelection(
    Object.hasOwn(caller, 'acceptedNoteIds') ? caller.acceptedNoteIds : null,
  );
  return cloneUtilityJson(params, '$') as UtilityParams;
}

export function preflightMp3(
  bytes: Uint8Array,
  contextRate = 48000,
  signal?: AbortSignal,
): Mp3Shape {
  abort(signal);
  if (
    !(bytes instanceof Uint8Array) ||
    !(bytes.buffer instanceof ArrayBuffer) ||
    bytes.length > 10 * 1024 * 1024
  )
    fail('$input', 'Select an MP3 of at most 10 MiB.');
  if (contextRate !== 48000)
    fail('$capability', 'This melody analysis requires a 48,000 Hz AudioContext.');
  let start = 0,
    end = bytes.length;
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]!) || bytes[4] === 255)
      fail('$input', 'Unsupported ID3 header.');
    const version = bytes[3]!;
    const mask = version === 2 ? 0xc0 : version === 3 ? 0xe0 : 0xf0;
    if ((bytes[5]! & ~mask) !== 0) fail('$input', 'Unsupported ID3 flags.');
    let size = 0;
    for (let index = 6; index < 10; index++) {
      if (bytes[index]! >= 128) fail('$input', 'Invalid ID3 synchsafe size.');
      size = size * 128 + bytes[index]!;
    }
    const footer = version === 4 && (bytes[5]! & 16) !== 0;
    start = 10 + size + (footer ? 10 : 0);
    if (start > 256 * 1024 || start > end) fail('$input', 'ID3 tag exceeds its bounded size.');
    if (footer) {
      const position = start - 10;
      if (
        bytes[position] !== 51 ||
        bytes[position + 1] !== 68 ||
        bytes[position + 2] !== 73 ||
        ![3, 4, 5, 6, 7, 8, 9].every((index) => bytes[position + index] === bytes[index])
      )
        fail('$input', 'Invalid ID3 footer.');
    }
  }
  if (
    end - start >= 128 &&
    bytes[end - 128] === 84 &&
    bytes[end - 127] === 65 &&
    bytes[end - 126] === 71
  )
    end -= 128;
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let rate: 44100 | 48000 | undefined,
    channelMode: number | undefined,
    frames = 0;
  for (let offset = start; offset < end;) {
    abort(signal);
    if (
      offset + 4 > end ||
      bytes[offset] !== 255 ||
      (bytes[offset + 1]! & 0xe0) !== 0xe0 ||
      ((bytes[offset + 1]! >> 3) & 3) !== 3 ||
      ((bytes[offset + 1]! >> 1) & 3) !== 1 ||
      (bytes[offset + 3]! & 3) === 2
    )
      fail('$input', 'Only aligned MPEG-1 Layer III frames are supported.');
    const bitrate = bitrates[bytes[offset + 2]! >> 4];
    const rateIndex = (bytes[offset + 2]! >> 2) & 3;
    const currentRate = rateIndex === 0 ? 44100 : rateIndex === 1 ? 48000 : undefined;
    const mode = bytes[offset + 3]! >> 6;
    if (
      !bitrate ||
      !currentRate ||
      (rate !== undefined && rate !== currentRate) ||
      (channelMode !== undefined && channelMode !== mode)
    )
      fail('$input', 'Unsupported or changing MP3 sample rate/channel layout.');
    rate = currentRate;
    channelMode = mode;
    const length = Math.floor((144000 * bitrate) / rate) + ((bytes[offset + 2]! >> 1) & 1);
    if (offset + length > end) fail('$input', 'Truncated MP3 frame.');
    offset += length;
    if ((++frames * 1152) / rate > 120) fail('$input', 'MP3 exceeds 120 seconds.');
  }
  if (!rate || !frames || channelMode === undefined) fail('$input', 'No supported MP3 frames.');
  const channels = channelMode === 3 ? 1 : 2;
  const maximumDecodedSamples = Math.ceil(((frames + 2) * 1152 * contextRate) / rate) * channels;
  if (maximumDecodedSamples > 12000000) fail('$input', 'Decoded MP3 sample budget exceeded.');
  return {
    sampleRate: rate,
    channels,
    frameCount: frames,
    duration: (frames * 1152) / rate,
    maximumDecodedSamples,
  };
}

export function analyzeMonoPitch(
  samples: Float32Array,
  provided: UtilityParams = {},
  signal?: AbortSignal,
): PitchReport {
  abort(signal);
  if (
    !(samples instanceof Float32Array) ||
    !(samples.buffer instanceof ArrayBuffer) ||
    samples.length > 960000
  )
    fail('$input', 'Analysis requires at most 120 seconds of 8,000 Hz mono samples.');
  const params = validatePitchParams(provided);
  const minHz = params.minHz as number,
    maxHz = params.maxHz as number;
  if (maxHz <= minHz) fail('maxHz', 'Highest pitch must exceed lowest pitch.');
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) fail('$input', 'Audio samples must be finite.');
    if ((index & 1023) === 0) abort(signal);
  }
  const minLag = Math.max(2, Math.floor(8000 / maxHz));
  const maxLag = Math.ceil(8000 / minHz);
  const window = 2048,
    hop = 256;
  const difference = new Float64Array(maxLag + 1);
  let operations = 0,
    voicedFrames = 0,
    unvoicedFrames = 0,
    previousNote: number | undefined;
  const groups: {
    note: number;
    start: number;
    end: number;
    frequencySum: number;
    confidenceSum: number;
    rmsSum: number;
    count: number;
  }[] = [];
  for (let offset = 0; offset + window <= samples.length; offset += hop) {
    abort(signal);
    let squares = 0;
    for (let index = 0; index < window; index++) squares += samples[offset + index]! ** 2;
    const rms = Math.sqrt(squares / window);
    if (rms < (params.noiseGate as number) || rms === 0) {
      unvoicedFrames++;
      previousNote = undefined;
      continue;
    }
    let cumulative = 0;
    difference[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let index = 0; index < window - maxLag; index++) {
        if ((++operations & 1023) === 0) abort(signal);
        if (operations > 800000000) fail('$input', 'Pitch difference-operation budget exceeded.');
        const delta = samples[offset + index]! - samples[offset + index + lag]!;
        sum += delta * delta;
      }
      cumulative += sum;
      difference[lag] = cumulative === 0 ? 1 : (sum * lag) / cumulative;
    }
    let lag = minLag;
    while (lag <= maxLag && difference[lag]! > 1 - (params.confidence as number)) lag++;
    if (lag > maxLag) {
      unvoicedFrames++;
      previousNote = undefined;
      continue;
    }
    while (lag < maxLag && difference[lag + 1]! < difference[lag]!) lag++;
    const confidence = 1 - difference[lag]!;
    let refined = lag;
    if (lag > minLag && lag < maxLag) {
      const denominator = difference[lag - 1]! - 2 * difference[lag]! + difference[lag + 1]!;
      if (denominator !== 0)
        refined += (0.5 * (difference[lag - 1]! - difference[lag + 1]!)) / denominator;
    }
    const frequency = 8000 / refined;
    if (
      !Number.isFinite(frequency) ||
      frequency < minHz ||
      frequency > maxHz ||
      confidence < (params.confidence as number)
    ) {
      unvoicedFrames++;
      previousNote = undefined;
      continue;
    }
    let note = Math.round(69 + 12 * Math.log2(frequency / 440));
    if (
      previousNote !== undefined &&
      Math.abs(1200 * Math.log2(frequency / (440 * 2 ** ((previousNote - 69) / 12)))) <= 35
    )
      note = previousNote;
    if (note < 0 || note > 127) {
      unvoicedFrames++;
      previousNote = undefined;
      continue;
    }
    previousNote = note;
    voicedFrames++;
    const start = (offset + window / 2 - hop / 2) / 8000,
      end = Math.min(samples.length / 8000, (offset + window / 2 + hop / 2) / 8000);
    const previous = groups.at(-1);
    if (
      previous &&
      previous.note === note &&
      start - previous.end <= (params.mergeGap as number) + 1e-12
    ) {
      previous.end = end;
      previous.frequencySum += frequency;
      previous.confidenceSum += confidence;
      previous.rmsSum += rms;
      previous.count++;
    } else
      groups.push({
        note,
        start,
        end,
        frequencySum: frequency,
        confidenceSum: confidence,
        rmsSum: rms,
        count: 1,
      });
  }
  const notes: PitchNote[] = groups
    .filter((group) => group.end - group.start >= (params.minDuration as number))
    .map((group, index) => ({
      id: `n${index}`,
      note: group.note,
      start: group.start,
      end: group.end,
      frequency: group.frequencySum / group.count,
      confidence: group.confidenceSum / group.count,
      velocity: Math.max(1, Math.min(127, Math.round((group.rmsSum / group.count) * 127))),
    }));
  if (notes.length > 20000) fail('$result', 'More than 20,000 notes.');
  selectPitchNotes(notes, params.acceptedNoteIds);
  abort(signal);
  return {
    notes,
    duration: samples.length / 8000,
    voicedFrames,
    unvoicedFrames,
    analysisRate: 8000,
    status: notes.length ? 'notes' : 'no-notes',
  };
}

export function selectPitchNotes(notes: PitchNote[], accepted: unknown): PitchNote[] {
  const copied = pitchSelection(accepted);
  if (copied === null) return notes;
  const ids = new Set(notes.map((note) => note.id));
  if (copied.some((id) => !ids.has(id)))
    fail('acceptedNoteIds', 'Selected note ID is not in this analysis.');
  const selected = new Set(copied);
  return notes.filter((note) => selected.has(note.id));
}

export function encodePitchMidi(notes: PitchNote[], tempo = 120, signal?: AbortSignal): Uint8Array {
  abort(signal);
  if (!Number.isInteger(tempo) || tempo < 30 || tempo > 300 || notes.length > 20000)
    fail('tempo', 'Use 30–300 integer BPM and at most 20,000 notes.');
  const microseconds = Math.round(60000000 / tempo);
  const tick = (seconds: number) => Math.round((seconds * 480000000) / microseconds);
  const events: { tick: number; off: boolean; note: number; velocity: number }[] = [];
  let previousEnd = 0;
  for (const note of notes) {
    abort(signal);
    if (
      !Number.isFinite(note.start) ||
      !Number.isFinite(note.end) ||
      note.start < previousEnd - 1e-12 ||
      note.end <= note.start ||
      note.end > 120 ||
      !Number.isInteger(note.note) ||
      note.note < 0 ||
      note.note > 127 ||
      !Number.isInteger(note.velocity) ||
      note.velocity < 1 ||
      note.velocity > 127
    )
      fail('$notes', 'MIDI needs ordered, finite, nonoverlapping bounded notes.');
    previousEnd = note.end;
    events.push(
      { tick: tick(note.start), off: false, note: note.note, velocity: note.velocity },
      { tick: tick(note.end), off: true, note: note.note, velocity: 0 },
    );
  }
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off) || a.note - b.note);
  const track: number[] = [
    0,
    255,
    81,
    3,
    microseconds >> 16,
    (microseconds >> 8) & 255,
    microseconds & 255,
    0,
    255,
    88,
    4,
    4,
    2,
    24,
    8,
  ];
  let previousTick = 0;
  for (const event of events) {
    if (!Number.isSafeInteger(event.tick) || event.tick < previousTick || event.tick > 0x0fffffff)
      fail('$notes', 'MIDI tick budget exceeded.');
    let delta = event.tick - previousTick;
    const bytes = [delta & 127];
    while ((delta = Math.floor(delta / 128)) > 0) bytes.unshift((delta & 127) | 128);
    track.push(...bytes, event.off ? 128 : 144, event.note, event.velocity);
    previousTick = event.tick;
    abort(signal);
  }
  track.push(0, 255, 47, 0);
  if (track.length > 1024 * 1024 - 22) fail('$result', 'MIDI track exceeds 1 MiB.');
  const result = new Uint8Array(22 + track.length);
  result.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107]);
  new DataView(result.buffer).setUint32(18, track.length);
  result.set(track, 22);
  return result;
}
