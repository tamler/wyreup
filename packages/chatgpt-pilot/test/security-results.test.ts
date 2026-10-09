import process from 'node:process';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createJobController } from '../src/jobs.js';
import { errorResult, boundedResult } from '../src/server.js';
import { LIMITS, PilotError } from '../src/limits.js';
import { validateOutput } from '../src/schemas.js';

const args = {
  file: { download_url: 'https://files.example.test/URL_CANARY', file_id: 'ID_CANARY', file_name: 'NAME_CANARY' },
  target_kb: 10, allow_downscale: false,
};

describe('bounded private result and worker isolation contracts', () => {
  it('accepts a 7 MiB inline result and rejects even one extra raw byte', () => {
    const acceptedBytes = 7 * 1024 * 1024;
    const result = {
      structuredContent: { status: 'success', operation: 'strip_image_metadata', inputBytes: 1,
        output: { name: 'metadata-removed.jpg', mimeType: 'image/jpeg', bytes: acceptedBytes } },
      content: [],
      _meta: { output: { name: 'metadata-removed.jpg', mimeType: 'image/jpeg', bytes: acceptedBytes,
        base64: Buffer.alloc(acceptedBytes).toString('base64'), sha256: 'a'.repeat(64) } },
    };
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(10 * 1024 * 1024);
    expect(boundedResult(result)).toBe(result);
    expect(() => boundedResult({ ...result,
      structuredContent: { ...result.structuredContent,
        output: { ...result.structuredContent.output, bytes: acceptedBytes + 1 } },
    })).toThrow('output byte limit');
    expect(LIMITS.fileBytes).toBe(8 * 1024 * 1024);
    expect(LIMITS.requestBytes).toBe(24 * 1024 * 1024);
  });

  it('enforces a 10 MiB serialized envelope at the exact byte boundary', () => {
    const result = {
      structuredContent: { status: 'success', operation: 'strip_image_metadata', inputBytes: 1,
        output: { name: 'metadata-removed.jpg', mimeType: 'image/jpeg', bytes: 1 } },
      content: [],
      _meta: { output: { name: 'metadata-removed.jpg', mimeType: 'image/jpeg', bytes: 1,
        base64: 'AA==', sha256: 'a'.repeat(64) }, padding: '' },
    };
    result._meta.padding = 'x'.repeat(10 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(result)));
    expect(Buffer.byteLength(JSON.stringify(result))).toBe(10 * 1024 * 1024);
    expect(boundedResult(result)).toBe(result);
    result._meta.padding += 'x';
    expect(() => boundedResult(result)).toThrow('output byte limit');
  });

  it('returns an explicit unreachable target error with numeric facts and no artifact', async () => {
    const pixels = Buffer.alloc(1024 * 1024 * 3);
    let seed = 123456;
    for (let index = 0; index < pixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const png = await sharp(pixels, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
    const jobs = createJobController(new Set(), {
      workerUrl: new URL('../dist/worker.js', import.meta.url),
      download: () => Promise.resolve(Uint8Array.from(png).buffer),
    });
    let failure: unknown;
    try { await jobs.run('compress_image_to_size', args, new AbortController().signal); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(PilotError);
    expect(failure).toHaveProperty('code', 'TARGET_UNREACHABLE');
    const result = errorResult('compress_image_to_size', failure);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 'error', targetReached: false, targetBytes: 10240 });
    expect(Number(result.structuredContent?.smallestBytes)).toBeGreaterThan(10240);
    expect(result._meta).toBeUndefined();
    expect(validateOutput(result.structuredContent)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('rejects a complete JSON envelope above the ceiling even with valid structured metadata', () => {
    const result = {
      structuredContent: { status: 'success', operation: 'strip_image_metadata', inputBytes: 1,
        output: { name: 'metadata-removed.jpg', mimeType: 'image/jpeg', bytes: 1 } },
      content: [],
      _meta: { output: { name: 'metadata-removed.jpg', mimeType: 'image/jpeg', bytes: 1,
        base64: 'x'.repeat(LIMITS.envelopeBytes), sha256: 'a'.repeat(64) } },
    };
    expect(validateOutput(result.structuredContent)).toBe(true);
    expect(() => boundedResult(result)).toThrow('output byte limit');
  });

  it('scrubs inherited environment and excludes caller descriptors while discarding owned worker output', async () => {
    const previous = process.env.WYREUP_PILOT_TEST_SECRET;
    process.env.WYREUP_PILOT_TEST_SECRET = 'ENV_PRIVATE_CANARY';
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    try {
      const jobs = createJobController(new Set(), {
        workerUrl: new URL('./fixtures/worker-canary.mjs', import.meta.url),
        download: () => Promise.resolve(new ArrayBuffer(1)),
      });
      await expect(jobs.run('compress_image_to_size', args, new AbortController().signal)).rejects.toHaveProperty('code', 'INVALID_FILE');
      const writes = [...stdout.mock.calls, ...stderr.mock.calls].map(call => String(call[0])).join('');
      expect(writes).not.toContain('WORKER_STDOUT_PRIVATE_CANARY');
      expect(writes).not.toContain('WORKER_STDERR_PRIVATE_CANARY');
      expect(writes).not.toContain('ENV_PRIVATE_CANARY');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      if (previous === undefined) delete process.env.WYREUP_PILOT_TEST_SECRET;
      else process.env.WYREUP_PILOT_TEST_SECRET = previous;
    }
  });
});
