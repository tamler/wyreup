import { describe, it, expect } from 'vitest';
import { runPreflight, readFileHeader } from '../../src/triggers/preflight.js';

describe('runPreflight — text inputs', () => {
  it('returns clean for benign English text', async () => {
    const file = new File(['Hello, world. This is a normal sentence.'], 'note.txt', {
      type: 'text/plain',
    });
    const r = await runPreflight(file);
    expect(r.verdict).toBe('clean');
    expect(r.toolUsed).toBe('text-suspicious');
  });

  it('flags zero-width injection on text/plain', async () => {
    // U+200B zero-width space embedded in an otherwise innocuous string.
    const payload = 'A​normal​looking​sentence.';
    const file = new File([payload], 'inject.txt', { type: 'text/plain' });
    const r = await runPreflight(file);
    expect(r.verdict).not.toBe('clean');
    expect(r.findings.some((f) => f.kind === 'invisible-injection')).toBe(true);
  });

  it('flags Cyrillic confusables on text/plain', async () => {
    // 'аpple.com' starts with Cyrillic а (U+0430), not Latin a.
    const file = new File(['Sign in to аpple.com'], 'phish.txt', { type: 'text/plain' });
    const r = await runPreflight(file);
    expect(r.verdict).not.toBe('clean');
    expect(r.toolUsed).toBe('text-suspicious');
  });

  it('analyses application/json', async () => {
    const file = new File(['{"safe":"value"}'], 'in.json', { type: 'application/json' });
    const r = await runPreflight(file);
    expect(r.toolUsed).toBe('text-suspicious');
    expect(r.verdict).toBe('clean');
  });
});

describe('runPreflight — non-analysable MIMEs', () => {
  it('returns clean+null for image/png (no analyser today)', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'x.png', {
      type: 'image/png',
    });
    const r = await runPreflight(file);
    expect(r.verdict).toBe('clean');
    expect(r.toolUsed).toBe(null);
  });

  it('returns clean+null for audio/wav', async () => {
    const file = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], 'x.wav', {
      type: 'audio/wav',
    });
    const r = await runPreflight(file);
    expect(r.toolUsed).toBe(null);
  });
});

describe('runPreflight — size cap', () => {
  it('skips analysis when file is over the pre-flight size limit', async () => {
    // 6 MB > 5 MB cap
    const buf = new Uint8Array(6 * 1024 * 1024);
    const file = new File([buf], 'big.txt', { type: 'text/plain' });
    const r = await runPreflight(file);
    expect(r.toolUsed).toBe(null);
    expect(r.verdict).toBe('clean');
  });
});

describe('readFileHeader', () => {
  it('reads the first N bytes as space-separated hex', async () => {
    const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef])], 'x.bin', {
      type: 'application/octet-stream',
    });
    const h = await readFileHeader(file, 4);
    expect(h.hex).toBe('de ad be ef');
  });

  it('recognises a PDF magic number', async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'x.pdf', {
      type: 'application/pdf',
    });
    const h = await readFileHeader(file);
    expect(h.signatureLabel).toBe('PDF');
  });

  it('recognises a PNG magic number', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], 'x.png', {
      type: 'image/png',
    });
    const h = await readFileHeader(file);
    expect(h.signatureLabel).toBe('PNG');
  });

  it('recognises a ZIP-shaped magic — supports the docx/.pdf-disguise spoof case (G2 motivation)', async () => {
    // A "PDF" with PK\x03 header → user must see ZIP-shaped on the preview.
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'spoof.pdf', {
      type: 'application/pdf',
    });
    const h = await readFileHeader(file);
    expect(h.signatureLabel).toBe('ZIP-shaped');
  });

  it('returns null label for unknown magic', async () => {
    const file = new File([new Uint8Array([0x00, 0x00, 0x00, 0x00])], 'x.bin', {
      type: 'application/octet-stream',
    });
    const h = await readFileHeader(file);
    expect(h.signatureLabel).toBe(null);
  });
});
