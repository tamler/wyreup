import { describe, it, expect } from 'vitest';
import { buildDryRun } from '../src/commands/chain-dryrun.js';
import { createDefaultRegistry } from '@wyreup/core';
import type { Chain } from '@wyreup/core';

const registry = createDefaultRegistry();

describe('buildDryRun', () => {
  it('reports a clean MIME flow for a same-format chain', () => {
    const chain: Chain = [
      { toolId: 'strip-exif', params: {} },
      { toolId: 'compress', params: { quality: 75 } },
    ];
    const result = buildDryRun(chain, registry);
    expect(result.mimeFlowOk).toBe(true);
    expect(result.text).toContain('strip-exif');
    expect(result.text).toContain('compress[quality=75]');
    expect(result.text).toContain('2 steps');
    expect(result.text).not.toContain('mime mismatch');
  });

  it('flags a MIME mismatch between adjacent steps', () => {
    // strip-exif outputs image/jpeg; geojson-to-kml expects geo+json/json/text/plain
    const chain: Chain = [
      { toolId: 'strip-exif', params: {} },
      { toolId: 'geojson-to-kml', params: {} },
    ];
    const result = buildDryRun(chain, registry);
    expect(result.mimeFlowOk).toBe(false);
    expect(result.text).toContain('mime mismatch');
    expect(result.text).toContain('image/jpeg');
    expect(result.text).toContain('advisory');
  });

  it('reports zero installs for an in-bundle-only chain', () => {
    const chain: Chain = [
      { toolId: 'csv-to-geojson', params: {} },
      { toolId: 'geojson-to-kml', params: {} },
    ];
    const result = buildDryRun(chain, registry);
    expect(result.totalInstallBytes).toBe(0);
    expect(result.text).toContain('none — every tool ships in-bundle');
  });

  it('reports install groups with sizes for a heavy chain', () => {
    // transcribe is in the speech install group (~250 MB).
    const chain: Chain = [{ toolId: 'transcribe', params: {} }];
    const result = buildDryRun(chain, registry);
    expect(result.totalInstallBytes).toBeGreaterThan(0);
    expect(result.text).toMatch(/speech\s+~?\d+\s*MB/);
  });

  it('shares an install group across multiple ffmpeg steps without double-counting', () => {
    const chain: Chain = [
      { toolId: 'convert-video', params: {} },
      { toolId: 'extract-audio', params: {} },
    ];
    const result = buildDryRun(chain, registry);
    // Both tools share installGroup 'ffmpeg'; the total should equal the
    // group size, not 2× the group size.
    const ffmpegMatch = /ffmpeg\s+~?(\d+(\.\d+)?)\s*MB/.exec(result.text);
    expect(ffmpegMatch).not.toBeNull();
    if (ffmpegMatch) {
      const groupMb = Number(ffmpegMatch[1]);
      const totalMb = result.totalInstallBytes / (1024 * 1024);
      expect(totalMb).toBeCloseTo(groupMb, 0);
    }
  });

  it('uses the max declared size when sibling tools in a group disagree', async () => {
    // Build a synthetic two-tool registry where both tools share an
    // installGroup but declare different installSize values. The group
    // total must reflect the max (not the last seen, not the sum).
    const { createRegistry } = await import('@wyreup/core');
    const fakeTool = (id: string, size: number) => ({
      id,
      slug: id,
      name: id,
      description: id,
      category: 'convert' as const,
      presence: 'both' as const,
      keywords: [],
      input: { accept: ['*/*'], min: 1 },
      output: { mime: 'application/octet-stream' },
      interactive: false,
      batchable: false,
      cost: 'free' as const,
      memoryEstimate: 'low' as const,
      defaults: {},
      installGroup: 'fake-group',
      installSize: size,
      Component: () => null,
      run: () => Promise.resolve([new Blob([''])]),
      __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/octet-stream'] },
    });
    const synth = createRegistry([
      fakeTool('small-tool', 10_000_000),
      fakeTool('big-tool', 100_000_000),
    ] as never);

    // Smaller-then-bigger and bigger-then-smaller both report ~100 MB.
    const a = buildDryRun(
      [{ toolId: 'small-tool', params: {} }, { toolId: 'big-tool', params: {} }],
      synth,
    );
    const b = buildDryRun(
      [{ toolId: 'big-tool', params: {} }, { toolId: 'small-tool', params: {} }],
      synth,
    );
    expect(a.totalInstallBytes).toBe(100_000_000);
    expect(b.totalInstallBytes).toBe(100_000_000);
  });

  it('rejects unknown tool ids with a clear message', () => {
    const chain: Chain = [{ toolId: 'no-such-tool', params: {} }];
    const result = buildDryRun(chain, registry);
    expect(result.mimeFlowOk).toBe(false);
    expect(result.text).toContain('Unknown tool');
    expect(result.text).toContain('no-such-tool');
  });

  it('always ends with the dry-run footer', () => {
    const chain: Chain = [{ toolId: 'strip-exif', params: {} }];
    const result = buildDryRun(chain, registry);
    expect(result.text).toContain('dry run — nothing executed');
  });
});
