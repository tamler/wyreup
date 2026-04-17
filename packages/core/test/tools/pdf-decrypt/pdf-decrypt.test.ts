import { describe, it, expect } from 'vitest';
import { pdfEncrypt } from '../../../src/tools/pdf-encrypt/index.js';
import { pdfDecrypt } from '../../../src/tools/pdf-decrypt/index.js';
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

async function makeEncryptedPdf(password: string): Promise<File> {
  const input = loadFixture('doc-a.pdf', 'application/pdf');
  const result = await pdfEncrypt.run([input], { userPassword: password }, makeCtx());
  const blob = Array.isArray(result) ? result[0]! : result;
  return new File([await blob.arrayBuffer()], 'encrypted.pdf', { type: 'application/pdf' });
}

describe('pdf-decrypt — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfDecrypt.id).toBe('pdf-decrypt');
    expect(pdfDecrypt.category).toBe('optimize');
  });

  it('output mime is application/pdf', () => {
    expect(pdfDecrypt.output.mime).toBe('application/pdf');
  });
});

describe('pdf-decrypt — run()', () => {
  it('throws if password is empty', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfDecrypt.run([input], { password: '' }, makeCtx()),
    ).rejects.toThrow('password');
  });

  it('decrypts an encrypted PDF with correct password', async () => {
    const encrypted = await makeEncryptedPdf('mypass');
    const result = await pdfDecrypt.run([encrypted], { password: 'mypass' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('passes through an unencrypted PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfDecrypt.run([input], { password: 'anypass' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });
});
