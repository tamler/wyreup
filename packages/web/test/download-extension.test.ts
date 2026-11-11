import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { knownExtensionForType } from '../src/components/runners/naming';

describe('download extension from a result MIME type', () => {
  it('names subtitle results so video sites accept them', () => {
    expect(knownExtensionForType('application/x-subrip')).toBe('srt');
    expect(knownExtensionForType('text/vtt')).toBe('vtt');
    expect(knownExtensionForType('text/vtt; charset=utf-8')).toBe('vtt');
  });

  it('leaves every other type to the caller’s existing rule', () => {
    expect(knownExtensionForType('image/png')).toBeUndefined();
    expect(knownExtensionForType('text/plain')).toBeUndefined();
  });

  it('is used by every chain and batch download namer', () => {
    for (const file of ['ChainRunner.svelte', 'ChainBuilder.svelte', 'BatchFolderRun.svelte']) {
      const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
      // Every place that derives an extension from a MIME subtype must try the
      // known map first.
      const namers = source.match(/\.type\.split\('\/'\)\[1\]/g) ?? [];
      const guarded = source.match(/knownExtensionForType\([^)]*\)\s*\?\?\s*\(?[\w.]*\.type\.split\('\/'\)\[1\]/g) ?? [];
      expect(namers.length, file).toBeGreaterThan(0);
      expect(guarded.length, file).toBe(namers.length);
    }
  });
});
