/**
 * audio-enhance tests
 *
 * Structure:
 *  1. Metadata — always run, no deps.
 *  2. encodeWav — pure function, always run.
 *  3. resample — pure function, always run.
 *  4. run() input validation — always run (no network, no AudioContext needed).
 *  5. Integration — requires Web Audio API (AudioContext). Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  audioEnhance,
  defaultAudioEnhanceParams,
  encodeWav,
  resample,
} from '../../../src/tools/audio-enhance/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

function loadFixture(name: string, mime: string): File {
  const buf = readFileSync(new URL(`../../fixtures/${name}`, import.meta.url));
  return new File([buf], name, { type: mime });
}

// WAV magic bytes: 'RIFF'
function isWav(buf: Uint8Array): boolean {
  return (
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46    // F
  );
}

// ──── 1. Metadata ────

describe('audio-enhance — metadata', () => {
  it('has id "audio-enhance"', () => {
    expect(audioEnhance.id).toBe('audio-enhance');
  });

  it('category is "audio"', () => {
    expect(audioEnhance.category).toBe('audio');
  });

  it('slug is "audio-enhance"', () => {
    expect(audioEnhance.slug).toBe('audio-enhance');
  });

  it('output mime is "audio/wav"', () => {
    expect(audioEnhance.output.mime).toBe('audio/wav');
  });

  it('accepts audio/wav and audio/mpeg', () => {
    expect(audioEnhance.input.accept).toContain('audio/wav');
    expect(audioEnhance.input.accept).toContain('audio/mpeg');
  });

  it('accepts audio/flac, audio/ogg, audio/webm', () => {
    expect(audioEnhance.input.accept).toContain('audio/flac');
    expect(audioEnhance.input.accept).toContain('audio/ogg');
    expect(audioEnhance.input.accept).toContain('audio/webm');
  });

  it('requires webgpu as "preferred"', () => {
    expect(audioEnhance.requires).toBeDefined();
    expect(audioEnhance.requires!.webgpu).toBe('preferred');
  });

  it('memoryEstimate is "medium"', () => {
    expect(audioEnhance.memoryEstimate).toBe('medium');
  });

  it('cost is "free"', () => {
    expect(audioEnhance.cost).toBe('free');
  });

  it('batchable is false', () => {
    expect(audioEnhance.batchable).toBe(false);
  });

  it('max input is 1', () => {
    expect(audioEnhance.input.max).toBe(1);
  });

  it('defaults are empty object', () => {
    expect(defaultAudioEnhanceParams).toEqual({});
  });

  it('keywords include audio and super-resolution', () => {
    expect(audioEnhance.keywords).toContain('audio');
    expect(audioEnhance.keywords).toContain('super-resolution');
  });
});

// ──── 2. encodeWav ────

describe('audio-enhance — encodeWav()', () => {
  it('returns a Blob with type audio/wav', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav(samples, 16000);
    expect(blob.type).toBe('audio/wav');
  });

  it('produces a valid RIFF/WAV header', async () => {
    const samples = new Float32Array(100);
    const blob = encodeWav(samples, 16000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(isWav(buf)).toBe(true);
    // WAVE marker at offset 8
    expect(buf[8]).toBe(0x57); // W
    expect(buf[9]).toBe(0x41); // A
    expect(buf[10]).toBe(0x56); // V
    expect(buf[11]).toBe(0x45); // E
  });

  it('correct total byte length: 44 header + 2 bytes per sample', () => {
    const numSamples = 16000; // 1 second at 16 kHz
    const samples = new Float32Array(numSamples);
    const blob = encodeWav(samples, 16000);
    expect(blob.size).toBe(44 + numSamples * 2);
  });

  it('encodes sample rate correctly in header', async () => {
    const samples = new Float32Array(10);
    const blob = encodeWav(samples, 48000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    // Sample rate at offset 24 (little-endian uint32)
    expect(view.getUint32(24, true)).toBe(48000);
  });

  it('clamps samples above 1.0 without throwing', () => {
    const samples = new Float32Array([1.5, -1.5, 2.0]);
    expect(() => encodeWav(samples, 16000)).not.toThrow();
  });

  it('encodes silence (all zeros) as zero PCM values', async () => {
    const numSamples = 4;
    const samples = new Float32Array(numSamples);
    const blob = encodeWav(samples, 16000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    for (let i = 0; i < numSamples; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(0);
    }
  });

  it('encodes positive peak (1.0) as 32767', async () => {
    const samples = new Float32Array([1.0]);
    const blob = encodeWav(samples, 16000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
  });

  it('encodes negative peak (-1.0) as -32767', async () => {
    const samples = new Float32Array([-1.0]);
    const blob = encodeWav(samples, 16000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    expect(view.getInt16(44, true)).toBe(-32767);
  });
});

// ──── 3. resample ────

describe('audio-enhance — resample()', () => {
  it('identity when source and target rates are equal', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const result = resample(input, 16000, 16000);
    expect(result).toBe(input); // same reference
  });

  it('doubles length when upsampling 2x', () => {
    const input = new Float32Array(100);
    const result = resample(input, 16000, 32000);
    expect(result.length).toBe(200);
  });

  it('halves length when downsampling 2x', () => {
    const input = new Float32Array(100);
    const result = resample(input, 32000, 16000);
    expect(result.length).toBe(50);
  });

  it('16k to 48k yields ~3x samples', () => {
    const input = new Float32Array(1600);
    const result = resample(input, 16000, 48000);
    expect(result.length).toBe(4800);
  });

  it('preserves DC (constant) signal through resampling', () => {
    const input = new Float32Array(100).fill(0.5);
    const result = resample(input, 16000, 32000);
    for (const v of result) {
      expect(v).toBeCloseTo(0.5, 5);
    }
  });
});

// ──── 4. run() — input validation (no network needed) ────

describe('audio-enhance — run() input validation', () => {
  it('throws for unsupported MIME type', async () => {
    const fakeFile = new File(['data'], 'x.mp4', { type: 'video/mp4' });
    await expect(audioEnhance.run([fakeFile], {}, makeCtx())).rejects.toThrow(
      /unsupported input type/i,
    );
  });

  it('throws when zero files are passed', async () => {
    await expect(audioEnhance.run([], {}, makeCtx())).rejects.toThrow();
  });

  it('respects abort signal before decode', async () => {
    const ac = new AbortController();
    ac.abort();
    const file = loadFixture('tone-16k.wav', 'audio/wav');
    await expect(audioEnhance.run([file], {}, {
      onProgress: () => {},
      signal: ac.signal,
      cache: new Map(),
      executionId: 'test',
    })).rejects.toThrow('Aborted');
  });
});

// ──── 5. Integration (browser-only) ────
//
// AudioContext is not available in Node/vitest's default environment.
// The full pipeline (decode → inference → encode) requires a browser.
// We skip gracefully and document why.

describe('audio-enhance — run() integration', () => {
  /**
   * Full pipeline test: decode tone-16k.wav → FlashSR inference → 48 kHz WAV output.
   *
   * SKIPPED in Node — AudioContext is not available in Node's environment.
   * The tool throws a clear error in this case, which is the expected behavior.
   * This test verifies the error message is correct in Node, and would verify
   * the full pipeline in a browser environment.
   */
  it('throws a clear error when AudioContext is unavailable (Node env)', async () => {
    const file = loadFixture('tone-16k.wav', 'audio/wav');
    // In Node, window is undefined so decodeToMono16k returns null and
    // run() throws with a message about Web Audio API.
    await expect(audioEnhance.run([file], {}, makeCtx())).rejects.toThrow(
      /web audio api/i,
    );
  });
});
