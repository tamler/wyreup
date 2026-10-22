import { describe, expect, it } from 'vitest';
import { analyzeMonoPitch, selectPitchNotes } from '../../src/utilities/midi-pitch.js';
import type { UtilityParams } from '../../src/utilities/common.js';

const silence = new Float32Array(0);
const tone = Float32Array.from(
  { length: 8000 },
  (_, index) => 0.4 * Math.sin((2 * Math.PI * 440 * index) / 8000),
);

describe('nullable pitch selection validation seam', () => {
  it('accepts omitted and explicit null selection while retaining computed preview notes', () => {
    const omitted = analyzeMonoPitch(tone);
    const explicit = analyzeMonoPitch(tone, { acceptedNoteIds: null });
    expect(explicit.notes).toEqual(omitted.notes);
    expect(analyzeMonoPitch(tone, { acceptedNoteIds: ['n0'] }).notes).toEqual(omitted.notes);
    expect(selectPitchNotes(omitted.notes, null)).toEqual(omitted.notes);
    expect(selectPitchNotes(omitted.notes, ['n0'])).toEqual(omitted.notes);
    expect(selectPitchNotes(omitted.notes, [])).toEqual([]);
  });

  it('rejects duplicate and stale selections at the direct analysis boundary', () => {
    expect(() => analyzeMonoPitch(silence, { acceptedNoteIds: ['n0', 'n0'] })).toThrow('unique');
    expect(() => analyzeMonoPitch(silence, { acceptedNoteIds: ['n0'] })).toThrow(
      'not in this analysis',
    );
    expect(() => analyzeMonoPitch(silence, { acceptedNoteIds: false })).toThrow('unique');
    expect(() => analyzeMonoPitch(silence, { acceptedNoteIds: [0] })).toThrow('unique');
  });

  it('keeps common numeric validation and rejects unknown parameters before projection', () => {
    expect(() => analyzeMonoPitch(silence, { tempo: 120.5 })).toThrow('whole number');
    expect(() => analyzeMonoPitch(silence, { confidence: 1 })).toThrow('Maximum');
    expect(() => analyzeMonoPitch(silence, { noiseGate: null })).toThrow('number');
    expect(() => analyzeMonoPitch(silence, { acceptedNoteIds: null, extra: true })).toThrow(
      'Unknown parameter',
    );
    expect(() =>
      analyzeMonoPitch(silence, JSON.parse('{"__proto__":true}') as UtilityParams),
    ).toThrow('Unknown parameter');
  });

  it('rejects accessors without reading them, including the standalone selector', () => {
    let reads = 0;
    const params = Object.defineProperty({}, 'acceptedNoteIds', {
      enumerable: true,
      get() {
        reads++;
        return null;
      },
    });
    expect(() => analyzeMonoPitch(silence, params)).toThrow('data properties');
    const accepted = Object.defineProperty(new Array(1), '0', {
      enumerable: true,
      get() {
        reads++;
        return 'n0';
      },
    });
    expect(() => selectPitchNotes([], accepted)).toThrow('accessors');
    expect(reads).toBe(0);
  });

  it('rejects custom prototypes, sparse arrays and oversized input before projection', () => {
    expect(() =>
      analyzeMonoPitch(silence, Object.create({ acceptedNoteIds: null }) as UtilityParams),
    ).toThrow('plain object');
    expect(() => analyzeMonoPitch(silence, { acceptedNoteIds: new Array(1) })).toThrow('dense');
    const accepted: string[] = [];
    Object.setPrototypeOf(accepted, null);
    expect(() => selectPitchNotes([], accepted)).toThrow('built-in array');
    expect(() => analyzeMonoPitch(silence, { extra: 'x'.repeat(1048577) })).toThrow('1 MiB');
    expect(() =>
      analyzeMonoPitch(silence, {
        acceptedNoteIds: Array.from({ length: 20001 }, (_, index) => `n${index}`),
      }),
    ).toThrow('20,000');
    expect(() =>
      analyzeMonoPitch(silence, {
        acceptedNoteIds: Array.from({ length: 19994 }, (_, index) => `n${index}`),
      }),
    ).toThrow('20,000');
  });
});
