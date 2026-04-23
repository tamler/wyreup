/**
 * Tests for parseChainString / serializeChain (in @wyreup/core).
 * These test the logic without needing to mock the module — core is a dev dep.
 */
import { describe, it, expect } from 'vitest';
import { parseChainString, serializeChain } from '@wyreup/core';

describe('parseChainString', () => {
  it('parses a single tool with no params', () => {
    const chain = parseChainString('strip-exif');
    expect(chain).toEqual([{ toolId: 'strip-exif', params: {} }]);
  });

  it('parses two tools separated by pipe', () => {
    const chain = parseChainString('strip-exif|compress');
    expect(chain).toHaveLength(2);
    expect(chain[0]!.toolId).toBe('strip-exif');
    expect(chain[1]!.toolId).toBe('compress');
  });

  it('parses tool with a single param', () => {
    const chain = parseChainString('compress[quality=75]');
    expect(chain[0]!.params).toEqual({ quality: 75 });
  });

  it('parses tool with multiple params', () => {
    const chain = parseChainString('resize[width=800,height=600]');
    expect(chain[0]!.params).toEqual({ width: 800, height: 600 });
  });

  it('coerces numeric values', () => {
    expect(parseChainString('compress[quality=80]')[0]!.params.quality).toBe(80);
  });

  it('coerces boolean true', () => {
    expect(parseChainString('foo[flag=true]')[0]!.params.flag).toBe(true);
  });

  it('coerces boolean false', () => {
    expect(parseChainString('foo[flag=false]')[0]!.params.flag).toBe(false);
  });

  it('keeps string values as strings', () => {
    expect(parseChainString('convert[format=webp]')[0]!.params.format).toBe('webp');
  });

  it('parses a three-step chain', () => {
    const chain = parseChainString('strip-exif|compress[quality=75]|face-blur');
    expect(chain).toHaveLength(3);
    expect(chain[0]!.toolId).toBe('strip-exif');
    expect(chain[1]!.toolId).toBe('compress');
    expect(chain[1]!.params.quality).toBe(75);
    expect(chain[2]!.toolId).toBe('face-blur');
  });

  it('trims whitespace from tool ids', () => {
    const chain = parseChainString(' strip-exif | compress ');
    expect(chain[0]!.toolId).toBe('strip-exif');
    expect(chain[1]!.toolId).toBe('compress');
  });

  it('returns empty array for empty string', () => {
    expect(parseChainString('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseChainString('   ')).toEqual([]);
  });

  it('handles tool with empty param brackets', () => {
    const chain = parseChainString('compress[]');
    expect(chain[0]!.toolId).toBe('compress');
    expect(chain[0]!.params).toEqual({});
  });

  it('ignores malformed param pairs (no equals sign)', () => {
    const chain = parseChainString('compress[noequals]');
    expect(chain[0]!.params).toEqual({});
  });
});

describe('serializeChain', () => {
  it('serializes a chain with no params', () => {
    const result = serializeChain([
      { toolId: 'strip-exif', params: {} },
      { toolId: 'compress', params: {} },
    ]);
    expect(result).toBe('strip-exif|compress');
  });

  it('serializes a chain with params', () => {
    const result = serializeChain([
      { toolId: 'compress', params: { quality: 75 } },
    ]);
    expect(result).toBe('compress[quality=75]');
  });

  it('round-trips through parseChainString', () => {
    const original = 'strip-exif|compress[quality=75]|face-blur';
    const parsed = parseChainString(original);
    const reserialized = serializeChain(parsed);
    expect(reserialized).toBe(original);
  });

  it('returns empty string for empty chain', () => {
    expect(serializeChain([])).toBe('');
  });
});
