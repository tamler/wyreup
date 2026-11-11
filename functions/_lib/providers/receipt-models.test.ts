import { describe, it, expect, vi } from 'vitest';
import {
  extractReceipt,
  imageDimensions,
  parseAmount,
  readReceiptInput,
  MODEL_CLAIRIC,
  MODEL_RECEIPT_FALLBACK,
  RECEIPT_FALLBACK_MAX_TOKENS,
  RECEIPT_FIELDS,
} from './receipt-models';
import type { Env } from '../env';

function envWith(run: (model: string, input: unknown) => unknown): Env {
  return {
    AI: { run: vi.fn((m: string, i: unknown) => Promise.resolve().then(() => run(m, i))) },
  } as unknown as Env;
}

const clairicAnswers = {
  vendor: {
    type: 'text',
    value: 'Northwind Supply',
    confidence: 0.99,
    p_null: 0.001,
    span: [0, 16],
  },
  document_number: { type: 'text', value: 'INV-2291', confidence: 1, p_null: 0 },
  date: { type: 'date', value: '2026-09-02', confidence: 0.98, p_null: 0.01 },
  due_date: { type: 'date', value: null, confidence: 0.9, p_null: 0.95 },
  currency: { type: 'text', value: 'USD', confidence: 0.7, p_null: 0.1 },
  subtotal: { type: 'number', value: 1000, confidence: 0.97, p_null: 0.01 },
  tax: { type: 'number', value: null, confidence: 0.8, p_null: 0.9 },
  total: { type: 'number', value: 1080, confidence: 0.99, p_null: 0.0 },
  line_items: { type: 'list', value: ['4 pallets $250.00'], confidence: 0.9 },
  contact: { type: 'text', value: null, confidence: 0.9, p_null: 0.99 },
};

describe('extractReceipt with clairic', () => {
  it('sends the typed field schema and returns values with confidence', async () => {
    const env = envWith(() => ({
      model: 'clairic',
      answers: clairicAnswers,
      truncated: false,
      usage: {},
    }));
    const out = await extractReceipt(env, { text: 'Invoice INV-2291 ...' });
    const call = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(MODEL_CLAIRIC);
    const payload = call[1] as {
      model: string;
      state: string;
      fields: Record<string, { type: string; items?: string }>;
      images?: unknown;
    };
    expect(payload.model).toBe('clairic');
    expect(payload.state).toBe('Invoice INV-2291 ...');
    expect(payload.images).toBeUndefined();
    expect(Object.keys(payload.fields)).toEqual(RECEIPT_FIELDS.map((f) => f.name));
    expect(payload.fields.line_items).toMatchObject({ type: 'list', items: 'text' });

    expect(out.engine).toBe('clairic');
    expect(out.hasConfidence).toBe(true);
    expect(out.fields.map((f) => f.name)).toEqual(RECEIPT_FIELDS.map((f) => f.name));
    const total = out.fields.find((f) => f.name === 'total')!;
    expect(total).toMatchObject({ value: 1080, missing: false, confidence: 0.99 });
    const due = out.fields.find((f) => f.name === 'due_date')!;
    expect(due).toMatchObject({ value: null, missing: true, pNull: 0.95 });
    expect(out.data.line_items).toEqual(['4 pallets $250.00']);
  });

  it('passes images and no state for photo input, and reports truncation', async () => {
    const env = envWith(() => ({ answers: clairicAnswers, truncated: true }));
    const out = await extractReceipt(env, { images: ['data:image/jpeg;base64,AAAA'] });
    const payload = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload.state).toBeUndefined();
    expect(payload.images).toEqual(['data:image/jpeg;base64,AAAA']);
    expect(out.truncated).toBe(true);
  });

  it('drops confidence values outside [0, 1]', async () => {
    const answers = { ...clairicAnswers, total: { type: 'number', value: 5, confidence: 7 } };
    const out = await extractReceipt(
      envWith(() => ({ answers })),
      { text: 'x' },
    );
    expect(out.fields.find((f) => f.name === 'total')!.confidence).toBeNull();
  });
});

describe('extractReceipt fallback', () => {
  const fallbackJson = JSON.stringify({
    vendor: 'Corner Cafe',
    document_number: null,
    date: '2026-11-01',
    due_date: null,
    currency: '$',
    subtotal: '9.00',
    tax: 0.72,
    total: '9.72',
    line_items: ['Latte 4.50', 'Bagel 4.50'],
    contact: null,
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('5028 model unavailable');
      },
    ],
    ['returns no answers', () => ({ error: 'nope' })],
    ['omits a field', () => ({ answers: { vendor: clairicAnswers.vendor } })],
  ] as [string, () => unknown][])(
    'falls back when clairic %s, with no confidence',
    async (_label, clairic) => {
      const env = envWith((model) => {
        if (model === MODEL_CLAIRIC) return clairic();
        return { choices: [{ message: { content: '```json\n' + fallbackJson + '\n```' } }] };
      });
      const out = await extractReceipt(env, { images: ['data:image/png;base64,AAAA'] });
      const calls = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
      expect(calls.map((c) => c[0])).toEqual([MODEL_CLAIRIC, MODEL_RECEIPT_FALLBACK]);
      const payload = calls[1][1] as { messages: { content: unknown }[]; max_tokens: number };
      expect(payload.max_tokens).toBe(RECEIPT_FALLBACK_MAX_TOKENS);
      expect(JSON.stringify(payload.messages)).toContain(
        '"image_url":{"url":"data:image/png;base64,AAAA"}',
      );

      expect(out.engine).toBe('fallback');
      expect(out.hasConfidence).toBe(false);
      expect(out.fields.every((f) => f.confidence === null && f.pNull === null)).toBe(true);
      expect(out.data).toMatchObject({
        vendor: 'Corner Cafe',
        subtotal: 9,
        tax: 0.72,
        total: 9.72,
        document_number: null,
      });
      expect(out.fields.find((f) => f.name === 'document_number')!.missing).toBe(true);
    },
  );

  it('accepts the legacy response field', async () => {
    const env = envWith((model) => (model === MODEL_CLAIRIC ? null : { response: fallbackJson }));
    const out = await extractReceipt(env, { text: 'Corner Cafe ...' });
    expect(out.data.vendor).toBe('Corner Cafe');
  });

  it('throws (so the run refunds) when the fallback output is not JSON', async () => {
    const env = envWith((model) => (model === MODEL_CLAIRIC ? null : { response: 'sorry' }));
    await expect(extractReceipt(env, { text: 'x' })).rejects.toThrow('unparseable');
  });
});

describe('imageDimensions', () => {
  const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  it('reads a PNG header', () => {
    const png = b64(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    );
    expect(imageDimensions(png, 'png')).toEqual({ width: 1, height: 1 });
  });

  it('rejects an animated PNG', () => {
    const png = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
    const actl = new Uint8Array([
      0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const apng = new Uint8Array([...png, ...actl]);
    expect(imageDimensions(apng, 'png')).toBeNull();
  });

  it('reads a JPEG SOF0 after an APP0 segment', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20,
      0x02, 0x58, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(imageDimensions(jpeg, 'jpeg')).toEqual({ width: 600, height: 800 });
  });

  function riff(chunk: string, body: number[]): Uint8Array {
    const head = [...'RIFF'].map((c) => c.charCodeAt(0));
    return new Uint8Array([
      ...head,
      0,
      0,
      0,
      0,
      ...[...'WEBP'].map((c) => c.charCodeAt(0)),
      ...[...chunk].map((c) => c.charCodeAt(0)),
      0,
      0,
      0,
      0,
      ...body,
    ]);
  }

  it('reads lossy, lossless and extended WebP headers', () => {
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x58, 0x02, 0x20, 0x03]);
    expect(imageDimensions(vp8, 'webp')).toEqual({ width: 600, height: 800 });
    // VP8L: width-1 = 599, height-1 = 799 packed as 14-bit fields.
    const w = 599;
    const h = 799;
    const vp8l = riff('VP8L', [
      0x2f,
      w & 0xff,
      ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
      (h >> 2) & 0xff,
      (h >> 10) & 0x0f,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(imageDimensions(vp8l, 'webp')).toEqual({ width: 600, height: 800 });
    const vp8x = riff('VP8X', [0, 0, 0, 0, 0x57, 0x02, 0x00, 0x1f, 0x03, 0x00]);
    expect(imageDimensions(vp8x, 'webp')).toEqual({ width: 600, height: 800 });
  });

  it('rejects animated WebP', () => {
    const vp8x = riff('VP8X', [0x02, 0, 0, 0, 0x57, 0x02, 0x00, 0x1f, 0x03, 0x00]);
    expect(imageDimensions(vp8x, 'webp')).toBeNull();
  });
});

describe('readReceiptInput', () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
  };

  it('accepts images within the pixel, edge and total caps', () => {
    expect(readReceiptInput({ images: [png(1600, 625), png(1000, 800)] }).images).toHaveLength(2);
  });

  it('rejects a long thin image that is under the pixel cap', () => {
    // 1 x 1,000,000 passes the pixel cap but would round up to ~71k patches.
    expect(() => readReceiptInput({ images: [png(1, 1_000_000)] })).toThrow('1600 pixels');
    expect(() => readReceiptInput({ images: [png(1601, 100)] })).toThrow('1600 pixels');
  });

  it('rejects more than 1.8 MP in total', () => {
    expect(() => readReceiptInput({ images: [png(1000, 1000), png(1000, 801)] })).toThrow('1.8');
  });

  it('caps text by UTF-8 bytes as well as characters', () => {
    expect(readReceiptInput({ text: 'a'.repeat(6000) }).text).toHaveLength(6000);
    // 3,001 CJK characters are 9,003 UTF-8 bytes.
    expect(() => readReceiptInput({ text: '中'.repeat(3001) })).toThrow('non-Latin');
    expect(() => readReceiptInput({ text: 'a'.repeat(6001) })).toThrow();
  });
});

describe('parseAmount', () => {
  it.each([
    ['9.72', 9.72],
    ['$9.72', 9.72],
    ['1,234.56', 1234.56],
    ['1,234', 1234],
    ['1.234,56', 1234.56],
    ['9,72', 9.72],
    ['-12.50 EUR', -12.5],
  ])('parses %s', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(['', 'n/a', '1,2,3', '12,3456', '1.2.3'])('returns null for %j', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});
