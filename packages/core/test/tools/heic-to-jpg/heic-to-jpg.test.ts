import { describe, it, expect } from 'vitest';
import { heicToJpg } from '../../../src/tools/heic-to-jpg/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('heic-to-jpg — metadata', () => {
  it('has the expected id and category', () => {
    expect(heicToJpg.id).toBe('heic-to-jpg');
    expect(heicToJpg.category).toBe('convert');
  });

  it('accepts HEIC/HEIF input only', () => {
    expect(heicToJpg.input.accept).toContain('image/heic');
    expect(heicToJpg.input.accept).toContain('image/heif');
  });

  it('paramSchema covers every defaults key', () => {
    for (const key of Object.keys(heicToJpg.defaults)) {
      expect(heicToJpg.paramSchema, key).toHaveProperty(key);
    }
  });
});

describe('heic-to-jpg — run()', () => {
  it('converts a real HEIC to JPEG by default', async () => {
    const input = loadFixture('photo.heic', 'image/heic');
    const outputs = await heicToJpg.run([input], {}, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('honors format=png', async () => {
    const input = loadFixture('photo.heic', 'image/heic');
    const outputs = await heicToJpg.run([input], { format: 'png' }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/png');
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('throws a readable error for non-HEIC bytes', async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], 'junk.heic', {
      type: 'image/heic',
    });
    await expect(heicToJpg.run([junk], {}, makeCtx())).rejects.toThrow();
  });
});
