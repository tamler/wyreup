import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode as cl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { encode as o200k } from 'gpt-tokenizer/encoding/o200k_base';
import { estimateTokens } from '../../../src/lib/pro-limits.js';
import { measureAudioDuration } from '../../../src/lib/audio-duration.js';

// Independent check: real byte-level BPE tokenizers (the cl100k and o200k
// vocabularies, the same family as Llama 3's tiktoken-based tokenizer) must
// never produce more tokens than our bound for any input. The cases include
// the review's counterexamples to the old 1-per-3-characters estimate.
describe('estimateTokens bounds real BPE tokenizers', () => {
  const rng = (() => {
    let seed = 0x2545f491;
    return () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x1_0000_0000;
    };
  })();
  const randomText = (length: number, ranges: Array<[number, number]>) =>
    Array.from({ length }, () => {
      const [lo, hi] = ranges[Math.floor(rng() * ranges.length)]!;
      return String.fromCodePoint(lo + Math.floor(rng() * (hi - lo)));
    }).join('');

  const cases: Array<[string, string]> = [
    ['digits and spaces', '1 '.repeat(5_000)],
    ['letters and spaces', 'a '.repeat(5_000)],
    ['rare CJK', '龘'.repeat(3_000)],
    ['emoji', '😀'.repeat(1_000)],
    ['mixed punctuation', '!?.,;:'.repeat(1_000)],
    ['random CJK', randomText(3_000, [[0x4e00, 0x9fff]])],
    [
      'random Devanagari and Tamil',
      randomText(3_000, [
        [0x0900, 0x097f],
        [0x0b80, 0x0bff],
      ]),
    ],
    [
      'random symbols and astral',
      randomText(2_000, [
        [0x2000, 0x2bff],
        [0x1f300, 0x1faff],
      ]),
    ],
    [
      'random everything',
      randomText(4_000, [
        [0x20, 0x7e],
        [0xa0, 0x2fff],
        [0x3000, 0xffef],
        [0x10000, 0x1ffff],
      ]),
    ],
  ];

  it.each(cases)('%s', (_name, text) => {
    const bound = estimateTokens(text);
    expect(cl100k(text).length).toBeLessThanOrEqual(bound);
    expect(o200k(text).length).toBeLessThanOrEqual(bound);
  });

  it('would have caught the old estimate', () => {
    const text = '1 '.repeat(5_000);
    const oldEstimate = Math.ceil(text.length / 3);
    expect(cl100k(text).length).toBeGreaterThan(oldEstimate);
  });
});

// Decoder-backed check for the WAV parser. FFmpeg is the reference; the
// test skips where ffprobe is not installed.
function hasFfprobe(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function fmt(sampleRate: number, channels: number, bits: number): Uint8Array {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  const blockAlign = (channels * bits) / 8;
  view.setUint16(0, 1, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, sampleRate, true);
  view.setUint32(8, sampleRate * blockAlign, true);
  view.setUint16(12, blockAlign, true);
  view.setUint16(14, bits, true);
  return chunk('fmt ', body);
}

function riff(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + total);
  out.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(out.buffer).setUint32(4, 4 + total, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  let offset = 12;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('WAV layouts a decoder could read differently are refused', () => {
  // The review's case, scaled down: 8 kHz mono 8-bit format, then the data,
  // then a second consistent format claiming 192 kHz, 8 channels, 64-bit.
  const data = chunk('data', new Uint8Array(80_000).fill(0x80)); // 10 s at 8 kB/s
  const duplicateFmt = riff(fmt(8_000, 1, 8), data, fmt(192_000, 8, 64));
  const twoFmtsFirst = riff(fmt(192_000, 8, 64), fmt(8_000, 1, 8), data);
  const twoData = riff(fmt(8_000, 1, 8), data, data);
  const plain = riff(fmt(8_000, 1, 8), data);

  it.each([
    ['second fmt after data', duplicateFmt],
    ['two fmt chunks before data', twoFmtsFirst],
    ['two data chunks', twoData],
  ])('refuses %s', (_name, bytes) => {
    expect(() => measureAudioDuration(bytes)).toThrow('more than one format or data section');
  });

  it('measures the plain layout', () => {
    expect(measureAudioDuration(plain).seconds).toBe(10);
  });

  it.skipIf(!hasFfprobe())('agrees with ffprobe on every layout it accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wyreup-wav-'));
    try {
      const probe = (bytes: Uint8Array) => {
        const path = join(dir, 'probe.wav');
        writeFileSync(path, bytes);
        const out = execFileSync(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
          { encoding: 'utf8' },
        );
        return Number(out.trim());
      };
      // The review's file decodes to the first format's duration (10 s
      // here), which is why accepting it at the last format's rate was wrong.
      expect(probe(duplicateFmt)).toBeCloseTo(10, 3);
      for (const bytes of [
        plain,
        riff(fmt(16_000, 2, 16), chunk('data', new Uint8Array(64_000))),
      ]) {
        const ours = measureAudioDuration(bytes).seconds;
        expect(probe(bytes)).toBeLessThanOrEqual(ours + 0.01);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
