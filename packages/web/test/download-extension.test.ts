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

  it('is used by the chain and batch downloads that the subtitle job reaches', () => {
    for (const file of ['ChainRunner.svelte', 'BatchFolderRun.svelte']) {
      const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
      expect(source, file).toMatch(/knownExtensionForType\(/);
    }
  });
});
