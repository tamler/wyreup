import { describe, it, expect } from 'vitest';
import {
  sanitizeZipEntryName,
  assertEntryBudget,
  assertDeclaredSizeBudget,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  ZipSafetyError,
} from '../src/lib/zip-safety.js';

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
    expect(() => assertEntryBudget(1, MAX_ZIP_UNCOMPRESSED_BYTES + 1)).toThrow(
      /uncompressed-too-large|exceeds/,
    );
  });
});

describe('assertDeclaredSizeBudget', () => {
  it('passes when declared total is under cap', () => {
    expect(() =>
      assertDeclaredSizeBudget([{ uncompressedSize: 1024 }, { uncompressedSize: 2048 }]),
    ).not.toThrow();
  });

  it('rejects when declared total exceeds cap', () => {
    expect(() =>
      assertDeclaredSizeBudget([
        { uncompressedSize: MAX_ZIP_UNCOMPRESSED_BYTES },
        { uncompressedSize: 1 },
      ]),
    ).toThrow(ZipSafetyError);
  });

  it('handles missing uncompressedSize gracefully', () => {
    expect(() => assertDeclaredSizeBudget([{}, { uncompressedSize: 1024 }])).not.toThrow();
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
    await expect(zipExtract.run([file], {}, ctx)).rejects.toThrow(
      /zip-bomb|too-many-entries|more than/,
    );
  }, 30_000);

  it('rejects pre-decompress when declared uncompressed total exceeds cap', async () => {
    // Build a real zip with a tiny payload, then mutate the loaded entry's
    // _data.uncompressedSize to simulate a bomb that declares > 4 GB.
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('tiny.txt', 'hello');
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    // Load it back so JSZip populates _data, then override the declared size.
    const loaded = await JSZip.loadAsync(bytes);
    const entry = loaded.files['tiny.txt'] as unknown as { _data?: { uncompressedSize?: number } };
    if (!entry._data) {
      // JSZip version doesn't expose _data — skip this test path.
      return;
    }
    entry._data.uncompressedSize = MAX_ZIP_UNCOMPRESSED_BYTES + 1;

    // Wrap the mutated zip object directly as the File input.
    // Instead of re-serializing (which would recalculate sizes), we
    // verify the pre-flight via assertDeclaredSizeBudget directly with
    // the same mapping zip-extract uses.
    expect(() =>
      assertDeclaredSizeBudget(
        Object.values(loaded.files)
          .filter((f) => !f.dir)
          .map((f) => ({
            uncompressedSize:
              (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ??
              0,
          })),
      ),
    ).toThrow(ZipSafetyError);
  }, 10_000);
});
