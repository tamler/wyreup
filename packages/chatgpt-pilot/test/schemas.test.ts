import { describe, expect, it } from 'vitest';
import { TOOLS, validateArguments, validateOutput } from '../src/schemas.js';
import { errorResult } from '../src/server.js';
import { PilotError } from '../src/limits.js';

const file = { download_url: 'https://files.example.test/signed?secret=INPUT_CANARY', file_id: 'FILE_ID_CANARY' };

describe('bounded file tool contracts', () => {
  it('exposes exactly the three tools and declares the actual file fields', () => {
    expect(TOOLS.map(tool => tool.name)).toEqual(['compress_image_to_size', 'strip_image_metadata', 'merge_pdfs']);
    expect(TOOLS.map(tool => tool._meta?.['openai/fileParams'])).toEqual([['file'], ['file'], ['files']]);
    expect(TOOLS.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it('accepts the two required file fields without invented optional requirements', () => {
    expect(validateArguments('compress_image_to_size', { file })).toEqual({ file });
    expect(validateArguments('merge_pdfs', { files: [file, file] })).toEqual({ files: [file, file] });
  });

  it.each([
    { file, local_path: '/etc/passwd' },
    { file: { ...file, path: '/etc/passwd' } },
    { file, target_kb: '10' },
    { file, target_kb: 10.5 },
    { file, target_kb: 9 },
    { file, target_kb: 10241 },
    { file, allow_downscale: 1 },
    { file: { download_url: file.download_url } },
  ])('rejects unknown fields, coercion, paths, and unsafe compression parameters', args => {
    expect(() => validateArguments('compress_image_to_size', args)).toThrow(PilotError);
  });

  it('rejects compression options on metadata removal and wrong PDF counts', () => {
    expect(() => validateArguments('strip_image_metadata', { file, target_kb: 10 })).toThrow(PilotError);
    expect(() => validateArguments('merge_pdfs', { files: [file] })).toThrow(PilotError);
    expect(() => validateArguments('merge_pdfs', { files: Array.from({ length: 6 }, () => file) })).toThrow(PilotError);
  });

  it('returns safe schema-congruent errors, keeping arbitrary exception data out of all fields', () => {
    const result = errorResult('merge_pdfs', new Error(`${file.download_url} ${file.file_id} FILE_BYTES_CANARY`));
    expect(result.isError).toBe(true);
    expect(result._meta).toBeUndefined();
    expect(validateOutput(result.structuredContent)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('limits host diagnostics to the host-deny code and target failures to numeric metadata', () => {
    expect(errorResult('strip_image_metadata', new PilotError('FILE_HOST_NOT_ENABLED', 'files.example.test')).structuredContent?.downloadHost).toBe('files.example.test');
    expect(errorResult('strip_image_metadata', new PilotError('FILE_URL_NOT_ALLOWED', 'files.example.test')).structuredContent?.downloadHost).toBeUndefined();
    const result = errorResult('compress_image_to_size', new PilotError('TARGET_UNREACHABLE', undefined, { targetBytes: 10240, smallestBytes: 20000 }));
    expect(result.structuredContent).toMatchObject({ targetReached: false, targetBytes: 10240, smallestBytes: 20000 });
    expect(result._meta).toBeUndefined();
    expect(validateOutput(result.structuredContent)).toBe(true);
  });
});
