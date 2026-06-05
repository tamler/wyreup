import { describe, it, expect } from 'vitest';
import { stripVideoMetadata, buildStripMetadataArgs } from '../../../src/tools/strip-video-metadata/index.js';

describe('strip-video-metadata', () => {
  it('id + privacy category + preserves container', () => {
    expect(stripVideoMetadata.id).toBe('strip-video-metadata');
    expect(stripVideoMetadata.categories).toContain('privacy');
    expect(stripVideoMetadata.output.mime).toBe('*/*');
  });
  it('drops metadata and stream-copies', () => {
    const args = buildStripMetadataArgs('in.mp4', 'out.mp4');
    expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args.at(-1)).toBe('out.mp4');
  });
});
