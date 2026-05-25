import { describe, it, expect } from 'vitest';
import { sanitizeZipEntryName, assertEntryBudget, MAX_ZIP_ENTRIES, MAX_ZIP_UNCOMPRESSED_BYTES, ZipSafetyError } from '../src/lib/zip-safety.js';

describe('sanitizeZipEntryName', () => {
  it('strips leading slashes', () => {
    expect(sanitizeZipEntryName('/absolute/path/file.txt')).toBe('absolute/path/file.txt');
  });

  it('drops parent traversal components', () => {
    expect(sanitizeZipEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeZipEntryName('subdir/../../escape.txt')).toBe('escape.txt');
  });

  it('normalizes Windows separators', () => {
    expect(sanitizeZipEntryName('folder\\sub\\file.txt')).toBe('folder/sub/file.txt');
  });

  it('strips null-byte components', () => {
    expect(sanitizeZipEntryName('safe/inner\0.txt')).toBe('safe');
  });

  it('rejects entries that have no usable component', () => {
    expect(() => sanitizeZipEntryName('../..')).toThrow(ZipSafetyError);
    expect(() => sanitizeZipEntryName('/')).toThrow(ZipSafetyError);
  });

  it('preserves normal relative paths', () => {
    expect(sanitizeZipEntryName('src/components/button.tsx')).toBe('src/components/button.tsx');
  });
});

describe('assertEntryBudget', () => {
  it('passes within both limits', () => {
    expect(() => assertEntryBudget(100, 1024 * 1024)).not.toThrow();
  });

  it('rejects too many entries', () => {
    expect(() => assertEntryBudget(MAX_ZIP_ENTRIES + 1, 1)).toThrow(/too-many-entries|more than/);
  });

  it('rejects uncompressed size over cap', () => {
    expect(() => assertEntryBudget(1, MAX_ZIP_UNCOMPRESSED_BYTES + 1)).toThrow(/uncompressed-too-large|exceeds/);
  });
});

describe('zip-extract bomb defense', () => {
  it('rejects an archive with > MAX_ZIP_ENTRIES entries', async () => {
    const JSZip = (await import('jszip')).default;
    const { zipExtract } = await import('../src/tools/zip-extract/index.js');
    const zip = new JSZip();
    for (let i = 0; i < 50_001; i++) zip.file(`f-${i}.txt`, 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([bytes.buffer as ArrayBuffer], 'bomb.zip', { type: 'application/zip' });
    const ctx = {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'test',
    } as never;
    await expect(zipExtract.run([file], {}, ctx)).rejects.toThrow(/zip-bomb|too-many-entries|more than/);
  }, 30_000);
});
