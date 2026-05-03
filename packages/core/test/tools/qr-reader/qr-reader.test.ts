import { describe, it, expect } from 'vitest';
import { qrReader } from '../../../src/tools/qr-reader/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { QrReaderResult } from '../../../src/tools/qr-reader/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('qr-reader — metadata', () => {
  it('has id qr-reader', () => {
    expect(qrReader.id).toBe('qr-reader');
  });

  it('is in the inspect category', () => {
    expect(qrReader.category).toBe('inspect');
  });

  it('accepts image MIME types', () => {
    expect(qrReader.input.accept).toContain('image/png');
    expect(qrReader.input.accept).toContain('image/jpeg');
  });

  it('outputs application/json', () => {
    expect(qrReader.output.mime).toBe('application/json');
  });
});

describe('qr-reader — run()', () => {
  it('returns detected:false for a plain PNG with no QR code', async () => {
    // Create a minimal 1x1 white PNG
    const canvas = await import('@napi-rs/canvas');
    const c = canvas.createCanvas(100, 100);
    const ctx2d = c.getContext('2d');
    ctx2d.fillStyle = 'white';
    ctx2d.fillRect(0, 0, 100, 100);
    const buf = c.toBuffer('image/png');
    const file = new File([buf as BlobPart], 'blank.png', { type: 'image/png' });
    const [out] = await qrReader.run([file], {}, makeCtx()) as Blob[];
    const result = JSON.parse(await out!.text()) as QrReaderResult;
    expect(result.detected).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('handles abort signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: ctrl.signal,
      cache: new Map(),
      executionId: 'test',
    };
    const file = new File([new Uint8Array(100)], 'test.png', { type: 'image/png' });
    await expect(qrReader.run([file], {}, ctx)).rejects.toThrow('Aborted');
  });
});
