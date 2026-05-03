import { describe, it, expect } from 'vitest';
import { shapefileToGeojson } from '../../../src/tools/shapefile-to-geojson/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('shapefile-to-geojson — metadata', () => {
  it('outputs application/geo+json', () => {
    expect(shapefileToGeojson.output.mime).toBe('application/geo+json');
  });

  it('accepts zip mimes', () => {
    expect(shapefileToGeojson.input.accept).toContain('application/zip');
  });

  it('is non-interactive (deterministic from input)', () => {
    expect(shapefileToGeojson.interactive).toBe(false);
  });
});

describe('shapefile-to-geojson — error cases', () => {
  it('rejects an obviously non-shapefile input', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'not-a-shapefile.zip', {
      type: 'application/zip',
    });
    await expect(shapefileToGeojson.run([file], {}, makeCtx())).rejects.toThrow();
  });

  it('rejects an empty zip', async () => {
    // Minimal empty zip: end-of-central-directory record only.
    const eocd = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const file = new File([eocd], 'empty.zip', { type: 'application/zip' });
    await expect(shapefileToGeojson.run([file], {}, makeCtx())).rejects.toThrow();
  });
});
