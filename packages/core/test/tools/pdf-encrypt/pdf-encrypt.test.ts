import { describe, it, expect } from 'vitest';
import { pdfEncrypt } from '../../../src/tools/pdf-encrypt/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pdf-encrypt — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfEncrypt.id).toBe('pdf-encrypt');
    expect(pdfEncrypt.category).toBe('optimize');
  });

  it('output mime is application/pdf', () => {
    expect(pdfEncrypt.output.mime).toBe('application/pdf');
  });
});

describe('pdf-encrypt — run()', () => {
  it('encrypts a PDF (output starts with %PDF and contains /Encrypt)', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfEncrypt.run(
      [input],
      { userPassword: 'secret123' },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');

    const bytes = Buffer.from(await blob.arrayBuffer());
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain('/Encrypt');
  });

  it('throws if userPassword is empty', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfEncrypt.run([input], { userPassword: '' }, makeCtx()),
    ).rejects.toThrow('userPassword');
  });

  it('throws if userPassword is whitespace only', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfEncrypt.run([input], { userPassword: '   ' }, makeCtx()),
    ).rejects.toThrow('userPassword');
  });

  it('accepts permissions flags', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfEncrypt.run(
      [input],
      {
        userPassword: 'secret',
        ownerPassword: 'owner',
        permissions: { copying: false, printing: 'none' },
      },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });
});
