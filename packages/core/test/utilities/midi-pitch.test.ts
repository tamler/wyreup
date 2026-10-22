import { describe, expect, it } from 'vitest';
import { analyzeMonoPitch, encodePitchMidi, preflightMp3, selectPitchNotes, type PitchNote } from '../../src/utilities/midi-pitch.js';

function sine(hz: number, seconds = 1, amplitude = 0.4): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * 8000) }, (_, index) => amplitude * Math.sin(2 * Math.PI * hz * index / 8000));
}
function frames(headers = [[255, 251, 144, 192], [255, 251, 144, 192]]): Uint8Array {
  const arrays = headers.map(header => {
    const size = (header[2]! >> 4) === 11 ? 626 : 417;
    const bytes = new Uint8Array(size); bytes.set(header); return bytes;
  });
  const bytes = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0; for (const array of arrays) { bytes.set(array, offset); offset += array.length; }
  return bytes;
}
function parseMidi(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('MThd');
  expect(data.getUint32(4)).toBe(6); expect(data.getUint16(8)).toBe(0); expect(data.getUint16(10)).toBe(1); expect(data.getUint16(12)).toBe(480);
  expect(new TextDecoder().decode(bytes.slice(14, 18))).toBe('MTrk'); expect(data.getUint32(18)).toBe(bytes.length - 22);
  const notes: { tick: number; on: boolean; note: number; velocity: number }[] = [];
  let offset = 22, tick = 0, tempo = 0, ended = false;
  while (offset < bytes.length) {
    let delta = 0, byte: number;
    do { byte = bytes[offset++]!; delta = delta * 128 + (byte & 127); } while (byte & 128);
    tick += delta;
    const status = bytes[offset++]!;
    if (status === 255) {
      const type = bytes[offset++]!, length = bytes[offset++]!;
      if (type === 81) { expect(length).toBe(3); tempo = bytes[offset]! * 65536 + bytes[offset + 1]! * 256 + bytes[offset + 2]!; }
      else if (type === 88) expect([...bytes.slice(offset, offset + length)]).toEqual([4, 2, 24, 8]);
      else { expect(type).toBe(47); expect(length).toBe(0); ended = true; }
      offset += length;
    } else {
      expect([128, 144]).toContain(status);
      notes.push({ tick, on: status === 144, note: bytes[offset++]!, velocity: bytes[offset++]! });
    }
  }
  expect(ended).toBe(true); expect(offset).toBe(bytes.length);
  return { tempo, notes };
}
describe('MP3 frame bounds and original monophonic analysis', () => {
  it('checks every frame and VBR layout before any native decode', () => {
    expect(preflightMp3(frames())).toMatchObject({ sampleRate: 44100, channels: 1, frameCount: 2 });
    expect(preflightMp3(frames([[255, 251, 144, 192], [255, 251, 176, 192]]))).toMatchObject({ frameCount: 2 });
    for (const bad of [frames().slice(0, -1), new Uint8Array([73, 68, 51]), frames([[255, 243, 144, 192]]), frames([[255, 251, 144, 192], [255, 251, 144, 0]])]) expect(() => preflightMp3(bad)).toThrow();
    expect(() => preflightMp3(frames(), 44100)).toThrow('48,000');
    const tag = new Uint8Array(10 + frames().length); tag.set([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]); tag.set(frames(), 10);
    expect(preflightMp3(tag).frameCount).toBe(2);
    tag[9] = 128; expect(() => preflightMp3(tag)).toThrow('synchsafe');
  });
  it.each([[220, 57], [440, 69]])('finds the fixed %s Hz PCM oracle, separately from MP3 decode', (hz, note) => {
    const report = analyzeMonoPitch(sine(hz));
    expect(report.status).toBe('notes'); expect(report.notes).toHaveLength(1);
    expect(report.notes[0]!.note).toBe(note); expect(Math.abs(report.notes[0]!.frequency / hz - 1)).toBeLessThan(0.01);
    expect(report.notes[0]!.start).toBeLessThanOrEqual(0.15); expect(1 - report.notes[0]!.end).toBeLessThanOrEqual(0.15);
    expect(report.notes[0]!.velocity).toBeGreaterThan(0); expect(report.notes[0]!.confidence).toBeGreaterThanOrEqual(0.85);
  });
  it('emits no guessed notes for silence or deterministic noise below the gate', () => {
    expect(analyzeMonoPitch(new Float32Array(8000))).toMatchObject({ status: 'no-notes', notes: [], voicedFrames: 0 });
    let state = 123;
    const noise = Float32Array.from({ length: 8000 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state / 4294967296 - 0.5) * 0.01; });
    expect(analyzeMonoPitch(noise, { noiseGate: 0.01 })).toMatchObject({ status: 'no-notes', notes: [], voicedFrames: 0 });
    expect(parseMidi(encodePitchMidi([])).notes).toEqual([]);
  });
  it('validates analysis inputs, selected IDs and cancellation', () => {
    expect(() => analyzeMonoPitch(new Float32Array([NaN]))).toThrow('finite');
    expect(() => analyzeMonoPitch(sine(440), { minHz: 1000, maxHz: 80 })).toThrow();
    expect(() => analyzeMonoPitch(sine(440), { unknown: true })).toThrow();
    const notes = analyzeMonoPitch(sine(440)).notes;
    expect(selectPitchNotes(notes, [])).toEqual([]); expect(selectPitchNotes(notes, null)).toEqual(notes);
    expect(() => selectPitchNotes(notes, ['not-present'])).toThrow();
    expect(() => selectPitchNotes(notes, ['n0', 'n0'])).toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => analyzeMonoPitch(sine(440), {}, controller.signal)).toThrow('cancelled');
  });
  it('encodes actual rounded tempo and note-off-before-on at ties', () => {
    const notes: PitchNote[] = [
      { id: 'n0', note: 57, start: 0, end: 1, frequency: 220, confidence: 1, velocity: 40 },
      { id: 'n1', note: 69, start: 1, end: 2, frequency: 440, confidence: 1, velocity: 50 },
    ];
    const result = parseMidi(encodePitchMidi(notes, 137));
    expect(result.tempo).toBe(437956);
    expect(result.notes.map(note => [note.on, note.note, note.velocity])).toEqual([[true, 57, 40], [false, 57, 0], [true, 69, 50], [false, 69, 0]]);
    expect(result.notes[1]!.tick).toBe(result.notes[2]!.tick);
    for (const [index, seconds] of [0, 1, 1, 2].entries()) expect(Math.abs(result.notes[index]!.tick * result.tempo / 480000000 - seconds)).toBeLessThanOrEqual(result.tempo / 480000000);
    expect(() => encodePitchMidi([{ ...notes[0]!, velocity: 0 }])).toThrow();
    expect(() => encodePitchMidi([notes[1]!, notes[0]!])).toThrow();
  });
});
