import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';
import { loadImage, createCanvas, canvasToBlob } from '../../lib/canvas.js';

// Mirrors the server caps in functions/_lib/providers/receipt-models.ts. The
// server re-checks every one; these exist so the client downscales before
// upload instead of failing after it.
export const RECEIPT_TEXT_MAX_CHARS = 6_000;
const TEXT_MAX_BYTES = 9_000;
export const RECEIPT_MAX_IMAGES = 4;
const IMAGE_MAX_BYTES = 1_572_864;
const IMAGE_MAX_PIXELS = 1_000_000;
const IMAGE_MAX_EDGE = 1_600;
const TOTAL_MAX_PIXELS = 1_800_000;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

export type ReceiptFieldType = 'text' | 'number' | 'date' | 'list';

export interface ReceiptField {
  name: string;
  label: string;
  type: ReceiptFieldType;
  value: string | number | string[] | null;
  missing: boolean;
  confidence: number | null;
  pNull: number | null;
}

export interface ReceiptExtractResult {
  engine: 'clairic' | 'fallback';
  model: string;
  hasConfidence: boolean;
  truncated: boolean;
  fields: ReceiptField[];
  data: Record<string, string | number | string[] | null>;
}

/**
 * Downscale and re-encode one photo as JPEG so it fits `maxPixels` and the
 * byte cap. Re-encoding also drops EXIF metadata such as GPS location.
 */
async function prepareImage(file: File, maxPixels: number): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (img.width * img.height)),
    IMAGE_MAX_EDGE / Math.max(img.width, img.height),
  );
  const width = Math.max(1, Math.floor(img.width * scale));
  const height = Math.max(1, Math.floor(img.height * scale));
  const canvas = await createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: paint white under transparent PNG / WebP areas.
  ctx.fillStyle = '#ffffff';
  (ctx as unknown as { fillRect(x: number, y: number, w: number, h: number): void }).fillRect(
    0,
    0,
    width,
    height,
  );
  ctx.drawImage(img, 0, 0, width, height);
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= IMAGE_MAX_BYTES) {
      const b64 = await fileToBase64(new File([blob], 'page.jpg', { type: 'image/jpeg' }));
      return `data:image/jpeg;base64,${b64}`;
    }
  }
  throw new Error(`${file.name} is still too large after downscaling.`);
}

export const receiptExtractPro: ToolModule<Record<string, never>> = {
  id: 'receipt-extract-pro',
  slug: 'receipt-extract-pro',
  name: 'Receipt and Invoice Extractor',
  description:
    'Pull vendor, dates, invoice number, currency, subtotal, tax, total, line items and contact details out of a receipt, invoice or simple bill. Paste the text or add up to 4 photos. Each field comes back with a missing flag and, from the primary hosted model, a confidence score. Double-check totals before you rely on them. Uses 2 credits per run.',
  category: 'text',
  keywords: [
    'receipt',
    'invoice',
    'bill',
    'expense',
    'extract',
    'ocr',
    'total',
    'tax',
    'line items',
    'json',
    'csv',
    'pro',
  ],

  input: {
    accept: ['text/plain', ...IMAGE_MIMES],
    min: 1,
    max: RECEIPT_MAX_IMAGES,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',

  chainSuggestions: ['json-formatter', 'json-flatten', 'csv-json'],

  defaults: {},
  paramSchema: {},

  async run(inputs: File[], _params: Record<string, never>, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length < 1 || inputs.length > RECEIPT_MAX_IMAGES)
      throw new Error(`Add one text file or 1 to ${RECEIPT_MAX_IMAGES} photos.`);
    const unsupported = inputs.find(
      (f) => !IMAGE_MIMES.includes(f.type) && f.type !== 'text/plain' && f.type !== '',
    );
    if (unsupported)
      throw new Error(`${unsupported.name}: use plain text or a PNG, JPEG or WebP photo.`);
    const texts = inputs.filter((f) => !IMAGE_MIMES.includes(f.type));
    let payload: Record<string, unknown>;

    if (texts.length > 0) {
      if (inputs.length !== 1) throw new Error('Send either one text input or photos, not both.');
      const text = (await inputs[0]!.text()).trim();
      if (!text) throw new Error('Empty input.');
      if (
        text.length > RECEIPT_TEXT_MAX_CHARS ||
        new TextEncoder().encode(text).length > TEXT_MAX_BYTES
      )
        throw new Error(
          `Text is over ${RECEIPT_TEXT_MAX_CHARS.toLocaleString('en-US')} characters (fewer for non-Latin scripts). Paste just the receipt or invoice.`,
        );
      payload = { text };
    } else {
      const perImage = Math.min(IMAGE_MAX_PIXELS, Math.floor(TOTAL_MAX_PIXELS / inputs.length));
      const images: string[] = [];
      for (const [i, file] of inputs.entries()) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        ctx.onProgress({
          stage: 'processing',
          percent: Math.round((i / inputs.length) * 40),
          message: `Preparing photo ${i + 1} of ${inputs.length}`,
        });
        images.push(await prepareImage(file, perImage));
      }
      payload = { images };
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Reading fields' });
    const result = await runPro<ReceiptExtractResult>('receipt-extract-pro', payload, ctx);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
