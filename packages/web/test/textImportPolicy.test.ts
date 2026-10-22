import { describe, expect, it } from 'vitest';
import {
  FATAL_TEXT_IMPORT_IDS,
  readImportedText,
  textAdmissionRequiresRun,
} from '../src/components/runners/textImportPolicy';

describe('per-tool text import byte and admission contracts', () => {
  it('keeps the reviewed fatal set exact and separate from permissive legacy readers', () => {
    expect([...FATAL_TEXT_IMPORT_IDS]).toEqual([
      'word-counter',
      'json-formatter',
      'json-path',
      'markdown-to-html',
      'code-beautifier',
      'remove-duplicate-lines-online',
      'markdown-table-generator',
      'bulk-meta-description-generator',
      'javascript-minifier',
    ]);
    expect(textAdmissionRequiresRun('number-base-converter')).toBe(true);
    expect(textAdmissionRequiresRun('cron-from-text')).toBe(true);
    expect(textAdmissionRequiresRun('url-encoder')).toBe(false);
  });

  it.each([...FATAL_TEXT_IMPORT_IDS])(
    '%s rejects invalid bytes and uses default BOM stripping',
    async (id) => {
      await expect(
        readImportedText(new File([new Uint8Array([0xff])], 'bad.txt'), id, {}),
      ).rejects.toThrow('valid UTF-8');
      expect(
        await readImportedText(
          new File([new Uint8Array([239, 187, 191, 65, 13, 10])], 'bom.txt'),
          id,
          {},
        ),
      ).toBe('A\r\n');
    },
  );

  it('keeps numeric and legacy File.text behavior while byte mode preserves BOM and refuses malformed bytes', async () => {
    const file = new File([new Uint8Array([239, 187, 191, 65, 13, 10])], 'bom.txt');
    expect(await readImportedText(file, 'number-base-converter', {})).toBe('A\r\n');
    expect(
      await readImportedText(file, 'number-base-converter', { conversionKind: 'utf8-bytes' }),
    ).toBe('\ufeffA\r\n');
    const invalid = new File([new Uint8Array([0xff, 65])], 'bad.txt');
    expect(await readImportedText(invalid, 'url-encoder', {})).toBe('\ufffdA');
    expect(await readImportedText(invalid, 'number-base-converter', {})).toBe('\ufffdA');
    await expect(
      readImportedText(invalid, 'number-base-converter', { conversionKind: 'utf8-bytes' }),
    ).rejects.toThrow('valid UTF-8');
  });

  it('refuses known oversize metadata before any slice or read', async () => {
    const file = new File(['x'], 'big.txt');
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 });
    let slices = 0;
    file.slice = () => {
      slices++;
      throw new Error('Must not read');
    };
    await expect(readImportedText(file, 'code-beautifier', {})).rejects.toThrow('size limit');
    expect(slices).toBe(0);
  });

  it('bounds understated actual fatal bytes before decoding', async () => {
    const file = new File(['x'.repeat(5 * 1024 * 1024 + 1)], 'understated.txt');
    Object.defineProperty(file, 'size', { value: 1 });
    await expect(readImportedText(file, 'code-beautifier', {})).rejects.toThrow('size limit');
  });

  it('matches the local cron decoder ceiling and fallback trim', async () => {
    expect(
      await readImportedText(
        new File(['\ufeff every day at 9am\r\n'], 'cron.txt'),
        'cron-from-text',
        {},
      ),
    ).toBe('every day at 9am');
    await expect(
      readImportedText(new File(['x'.repeat(4097)], 'cron.txt'), 'cron-from-text', {}),
    ).rejects.toThrow('size limit');
  });
});
