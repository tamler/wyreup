// Receipt and invoice field extraction (receipt-extract-pro).
//
// Primary: @cf/cloudflare/clairic, a typed extraction model that returns a
// value, a confidence and a null probability per field. It is a preview
// model offered "as is" and may be withdrawn without notice, so any clairic
// failure falls back to @cf/google/gemma-4-26b-a4b-it (vision LLM). Fallback
// results carry no model confidence: we never invent one.
//
// Model page (input schema, limits, price) checked 2026-11-11:
// https://developers.cloudflare.com/workers-ai/models/clairic/

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export const MODEL_CLAIRIC = '@cf/cloudflare/clairic';
export const MODEL_RECEIPT_FALLBACK = '@cf/google/gemma-4-26b-a4b-it';

// ── Input caps (server-enforced in runners.ts, mirrored in the core tool) ──
export const RECEIPT_TEXT_MAX_CHARS = 6_000;
/** UTF-8 bytes of pasted text; bounds tokens for non-Latin scripts too. */
export const RECEIPT_TEXT_MAX_BYTES = 9_000;
export const RECEIPT_MAX_IMAGES = 4;
/** Decoded bytes per image. Clairic allows 4 MiB each; we keep well under. */
export const RECEIPT_IMAGE_MAX_BYTES = 1_572_864;
/** Pixels per image (width x height), read from the image header. */
export const RECEIPT_IMAGE_MAX_PIXELS = 1_000_000;
/** Longest side of any image, in pixels. Bounds patch rounding per edge. */
export const RECEIPT_IMAGE_MAX_EDGE = 1_600;
/** Pixels across all images in one run. */
export const RECEIPT_TOTAL_MAX_PIXELS = 1_800_000;
/** Output cap for the fallback LLM. Clairic bills input tokens only. */
export const RECEIPT_FALLBACK_MAX_TOKENS = 2_048;
/** Line items the fallback is asked for, so its JSON fits the output cap. */
const FALLBACK_MAX_LINE_ITEMS = 40;
const CLAIRIC_TIMEOUT_MS = 30_000;

export type ReceiptFieldType = 'text' | 'number' | 'date' | 'list';

export interface ReceiptFieldSpec {
  name: string;
  label: string;
  type: ReceiptFieldType;
  instructions: string;
}

// Ten fixed fields. The count matters for the cost bound below (clairic may
// split fields across parallel passes, each of which re-reads the input).
export const RECEIPT_FIELDS: readonly ReceiptFieldSpec[] = [
  {
    name: 'vendor',
    label: 'Vendor',
    type: 'text',
    instructions: 'Business or person that issued the receipt or invoice',
  },
  {
    name: 'document_number',
    label: 'Invoice or receipt number',
    type: 'text',
    instructions: 'Invoice, receipt or order number',
  },
  {
    name: 'date',
    label: 'Date',
    type: 'date',
    instructions: 'Date the receipt or invoice was issued',
  },
  {
    name: 'due_date',
    label: 'Due date',
    type: 'date',
    instructions: 'Date payment is due, only if stated or derivable from payment terms',
  },
  {
    name: 'currency',
    label: 'Currency',
    type: 'text',
    instructions: 'Currency code or symbol of the amounts as written, such as USD, EUR or $',
  },
  { name: 'subtotal', label: 'Subtotal', type: 'number', instructions: 'Amount before tax' },
  { name: 'tax', label: 'Tax', type: 'number', instructions: 'Total tax amount' },
  {
    name: 'total',
    label: 'Total',
    type: 'number',
    instructions: 'Final amount due or paid, including tax',
  },
  {
    name: 'line_items',
    label: 'Line items',
    type: 'list',
    instructions: 'Each purchased item line as written, with quantity and price if shown',
  },
  {
    name: 'contact',
    label: 'Contact',
    type: 'text',
    instructions: 'Phone number, email address or website of the vendor',
  },
];

function clairicFields(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of RECEIPT_FIELDS) {
    const spec: Record<string, unknown> = { type: f.type, instructions: f.instructions };
    if (f.type === 'number') spec.decimals = 2;
    if (f.type === 'list') spec.items = 'text';
    out[f.name] = spec;
  }
  return out;
}

// ── Worst-case Cloudflare cost (asserted by pricing-margin.test.ts) ─────────
//
// List prices verified 2026-11-11 from the Workers AI pricing page:
//   clairic  $0.10 / M input tokens, no output charge
//   gemma-4  $0.10 / M input, $0.30 / M output
// Assumptions, each chosen to over-count:
//   - Text: 1 token per UTF-8 byte. Byte-level and byte-fallback tokenizers
//     never emit more tokens than bytes (clairic's own English example is
//     ~2.3 chars/token).
//   - Images: 1 token per 14x14 pixel patch, rounded up on each edge, plus
//     256 tokens overhead each. For w x h that is at most
//     w*h/196 + (w+h)/14 + 1 patches, and w+h <= 2 x the edge cap.
//     Neither model page publishes an image token rate, so this is a
//     deliberately high bound on capped pixels.
//   - Schema: 2 tokens per character of the JSON field spec (the model page
//     example bills ~1.1 per character).
//   - Clairic passes: one per field. Each pass reads the whole input and we
//     count the schema in full on every pass.
//   - The clairic call may fail after being billed; the fallback then runs
//     once with its full output cap. No other retries happen.
const USD_PER_M = {
  clairicIn: 0.1,
  fallbackIn: 0.1,
  fallbackOut: 0.3,
};
const PIXELS_PER_IMAGE_TOKEN = 14 * 14;
const IMAGE_TOKEN_OVERHEAD = 256;
/** Upper bound on the fallback system + instruction prompt, in tokens. */
const FALLBACK_PROMPT_TOKENS = 1_500;

export interface ReceiptCostBreakdown {
  textModeUsd: number;
  imageModeUsd: number;
  worstUsd: number;
}

export function receiptWorstCaseUsd(): ReceiptCostBreakdown {
  const schemaTokens = 2 * JSON.stringify(clairicFields()).length;
  const passes = RECEIPT_FIELDS.length;
  const edgeRounding = Math.ceil((2 * RECEIPT_IMAGE_MAX_EDGE) / 14) + 1;
  const imageTokens =
    Math.ceil(RECEIPT_TOTAL_MAX_PIXELS / PIXELS_PER_IMAGE_TOKEN) +
    RECEIPT_MAX_IMAGES * (edgeRounding + IMAGE_TOKEN_OVERHEAD);
  const textTokens = RECEIPT_TEXT_MAX_BYTES;
  const fallbackOutUsd = (RECEIPT_FALLBACK_MAX_TOKENS * USD_PER_M.fallbackOut) / 1e6;

  const mode = (inputTokens: number) =>
    (passes * (inputTokens + schemaTokens) * USD_PER_M.clairicIn) / 1e6 +
    ((inputTokens + FALLBACK_PROMPT_TOKENS) * USD_PER_M.fallbackIn) / 1e6 +
    fallbackOutUsd;

  // Text and images are mutually exclusive per run (enforced in runners.ts).
  const textModeUsd = mode(textTokens);
  const imageModeUsd = mode(imageTokens);
  return { textModeUsd, imageModeUsd, worstUsd: Math.max(textModeUsd, imageModeUsd) };
}

// ── Input validation (runs before any provider work) ───────────────────────

/**
 * Validate the untrusted client input. Pasted text OR 1 to 4 images, never
 * both: the caps checked here are exactly what receiptWorstCaseUsd assumes.
 */
export function readReceiptInput(raw: Record<string, unknown>): ReceiptInput {
  const textRaw = raw.text;
  const imagesRaw = raw.images;
  if (textRaw !== undefined && imagesRaw !== undefined)
    throw new Error('Send either text or images, not both');
  if (imagesRaw === undefined) {
    if (typeof textRaw !== 'string' || textRaw.trim().length === 0)
      throw new Error("'text' (non-empty string) or 'images' is required");
    if (
      textRaw.length > RECEIPT_TEXT_MAX_CHARS ||
      new TextEncoder().encode(textRaw).length > RECEIPT_TEXT_MAX_BYTES
    )
      throw new Error(
        `Text exceeds ${RECEIPT_TEXT_MAX_CHARS.toLocaleString('en-US')} characters (fewer for non-Latin scripts)`,
      );
    return { text: textRaw };
  }
  if (!Array.isArray(imagesRaw) || imagesRaw.length < 1 || imagesRaw.length > RECEIPT_MAX_IMAGES)
    throw new Error(`Send 1 to ${RECEIPT_MAX_IMAGES} images`);
  let totalPixels = 0;
  const images = imagesRaw.map((v: unknown) => {
    if (typeof v !== 'string') throw new Error('Each image must be a data URL');
    const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(v);
    if (!prefix) throw new Error('Each image must be a PNG, JPEG, or WebP data URL');
    const bytes = decodeImageBase64(v.slice(prefix[0].length));
    const format = sniffFormat(bytes);
    if (!format || format !== prefix[1])
      throw new Error('Image bytes do not match the declared format');
    const dims = imageDimensions(bytes, format);
    if (!dims) throw new Error('Could not read image size (animated images are not supported)');
    if (dims.width * dims.height > RECEIPT_IMAGE_MAX_PIXELS)
      throw new Error('Each image must be 1 megapixel or smaller');
    if (dims.width > RECEIPT_IMAGE_MAX_EDGE || dims.height > RECEIPT_IMAGE_MAX_EDGE)
      throw new Error(`Each image side must be ${RECEIPT_IMAGE_MAX_EDGE} pixels or less`);
    totalPixels += dims.width * dims.height;
    return v;
  });
  if (totalPixels > RECEIPT_TOTAL_MAX_PIXELS)
    throw new Error('Images exceed 1.8 megapixels in total');
  return { images };
}

function decodeImageBase64(b64: string): Uint8Array {
  if (!b64 || b64.length > Math.ceil(RECEIPT_IMAGE_MAX_BYTES / 3) * 4)
    throw new Error('Image exceeds size cap or is empty');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('Invalid image base64');
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error('Invalid image base64');
  }
  if (!binary.length || binary.length > RECEIPT_IMAGE_MAX_BYTES)
    throw new Error('Image exceeds size cap or is empty');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function sniffFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp';
  return null;
}

// ── Extraction ─────────────────────────────────────────────────────────────

export interface ReceiptInput {
  /** Pasted text. Exactly one of text / images is set. */
  text?: string;
  /** Validated PNG / JPEG / WebP data URLs. */
  images?: string[];
}

export interface ReceiptField {
  name: string;
  label: string;
  type: ReceiptFieldType;
  value: string | number | string[] | null;
  missing: boolean;
  /** Model confidence in [0, 1]; null when the model gives none. */
  confidence: number | null;
  /** Model probability that the field is absent; null when not given. */
  pNull: number | null;
}

export interface ReceiptResult {
  engine: 'clairic' | 'fallback';
  model: string;
  /** False for fallback results: no confidence numbers are available. */
  hasConfidence: boolean;
  /** True when clairic reports it could not read the whole input. */
  truncated: boolean;
  fields: ReceiptField[];
  /** Same values keyed by field name, for chaining into other tools. */
  data: Record<string, string | number | string[] | null>;
}

export async function extractReceipt(env: Env, input: ReceiptInput): Promise<ReceiptResult> {
  let primary: ReceiptResult;
  try {
    primary = await runClairic(env, input);
  } catch {
    // Preview model: unavailable, removed or malformed output. Use the
    // fallback. If that fails too, its error reaches the caller (refund).
    return runFallback(env, input);
  }
  return primary;
}

async function runClairic(env: Env, input: ReceiptInput): Promise<ReceiptResult> {
  const payload: Record<string, unknown> = {
    model: 'clairic',
    fields: clairicFields(),
  };
  if (input.text) payload.state = input.text;
  if (input.images?.length) payload.images = input.images;

  const res = (await withTimeout(
    env.AI.run(MODEL_CLAIRIC, payload),
    CLAIRIC_TIMEOUT_MS,
    'receipt-model (clairic)',
  )) as { answers?: unknown; truncated?: unknown } | null;
  const answers = res?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('Clairic returned no answers');
  }
  const byName = answers as Record<string, unknown>;
  const fields = RECEIPT_FIELDS.map((spec) => {
    const a = byName[spec.name];
    if (!a || typeof a !== 'object') throw new Error(`Clairic omitted field ${spec.name}`);
    const ans = a as Record<string, unknown>;
    return buildField(spec, ans.value, probability(ans.confidence), probability(ans.p_null));
  });
  return finish('clairic', MODEL_CLAIRIC, true, res?.truncated === true, fields);
}

async function runFallback(env: Env, input: ReceiptInput): Promise<ReceiptResult> {
  const keys = RECEIPT_FIELDS.map(
    (f) =>
      `"${f.name}": ${f.type === 'list' ? 'array of strings' : f.type === 'number' ? 'number' : f.type === 'date' ? 'YYYY-MM-DD string' : 'string'} (${f.instructions})`,
  ).join('\n');
  const instruction =
    'Read the receipt or invoice and reply with ONLY a JSON object, no markdown, with exactly these keys:\n' +
    keys +
    '\nUse null for anything not shown. Copy text as written; give amounts as plain numbers with a dot for decimals. Do not calculate or guess missing amounts.' +
    ` List at most ${FALLBACK_MAX_LINE_ITEMS} line items.`;

  const content: unknown[] = [
    { type: 'text', text: input.text ? `${instruction}\n\nDocument:\n${input.text}` : instruction },
  ];
  for (const url of input.images ?? []) content.push({ type: 'image_url', image_url: { url } });

  const res = (await withTimeout(
    env.AI.run(MODEL_RECEIPT_FALLBACK, {
      messages: [
        { role: 'system', content: 'You extract fields from receipts and invoices into JSON.' },
        { role: 'user', content },
      ],
      max_tokens: RECEIPT_FALLBACK_MAX_TOKENS,
      max_completion_tokens: RECEIPT_FALLBACK_MAX_TOKENS,
    }),
    INFERENCE_TIMEOUTS.vision,
    'receipt-model (fallback)',
  )) as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;

  const text =
    typeof res?.response === 'string'
      ? res.response
      : typeof res?.choices?.[0]?.message?.content === 'string'
        ? res.choices[0].message.content
        : '';
  const parsed = parseJsonObject(text);
  if (!parsed) throw new Error('Receipt model returned unparseable output');
  const fields = RECEIPT_FIELDS.map((spec) => buildField(spec, parsed[spec.name], null, null));
  return finish('fallback', MODEL_RECEIPT_FALLBACK, false, false, fields);
}

function finish(
  engine: ReceiptResult['engine'],
  model: string,
  hasConfidence: boolean,
  truncated: boolean,
  fields: ReceiptField[],
): ReceiptResult {
  const data: ReceiptResult['data'] = {};
  for (const f of fields) data[f.name] = f.value;
  return { engine, model, hasConfidence, truncated, fields, data };
}

function buildField(
  spec: ReceiptFieldSpec,
  raw: unknown,
  confidence: number | null,
  pNull: number | null,
): ReceiptField {
  const value = coerce(spec.type, raw);
  return {
    name: spec.name,
    label: spec.label,
    type: spec.type,
    value,
    missing: value === null,
    confidence,
    pNull,
  };
}

const MAX_VALUE_CHARS = 500;
const MAX_LIST_ITEMS = 200;

function coerce(type: ReceiptFieldType, raw: unknown): ReceiptField['value'] {
  if (raw === null || raw === undefined) return null;
  if (type === 'list') {
    if (!Array.isArray(raw)) return null;
    const items = raw
      .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''))
      .filter(Boolean)
      .slice(0, MAX_LIST_ITEMS)
      .map((v) => v.slice(0, MAX_VALUE_CHARS));
    return items.length ? items : null;
  }
  if (type === 'number') {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    return typeof raw === 'string' ? parseAmount(raw) : null;
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const s = String(raw).trim().slice(0, MAX_VALUE_CHARS);
    return s || null;
  }
  return null;
}

/**
 * Parse an amount written as a string. Accepts "1,234.56" and "1.234,56"
 * styles and drops currency symbols. Returns null for anything ambiguous or
 * malformed rather than guessing a different number.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, '');
  const sign = s.startsWith('-') ? '-' : '';
  const body = sign ? s.slice(1) : s;
  if (/^\d+(\.\d+)?$/.test(body)) return Number(sign + body);
  // Dot decimal with comma thousands: 1,234 / 1,234.56
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) return Number(sign + body.replace(/,/g, ''));
  // Comma decimal (1 or 2 digits), optional dot thousands: 9,72 / 1.234,56
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(body) || /^\d+,\d{1,2}$/.test(body))
    return Number(sign + body.replace(/\./g, '').replace(',', '.'));
  return null;
}

function probability(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

function parseJsonObject(s: string): Record<string, unknown> | null {
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const v: unknown = JSON.parse(cleaned);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Image header parsing (server-side pixel cap) ───────────────────────────

/**
 * Width and height from a PNG, JPEG or WebP header, or null when the header
 * cannot be read. Animated PNG / WebP return null so callers reject them:
 * frame count would otherwise be unbounded input.
 */
export function imageDimensions(
  bytes: Uint8Array,
  format: 'png' | 'jpeg' | 'webp',
): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32be = (i: number) =>
    ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  const ok = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;

  if (format === 'png') {
    if (bytes.length < 24 || ascii(12, 4) !== 'IHDR') return null;
    // Reject APNG: an acTL chunk anywhere before the image data.
    for (let i = 8; i + 8 <= bytes.length;) {
      const len = u32be(i);
      const type = ascii(i + 4, 4);
      if (type === 'acTL') return null;
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return ok(u32be(16), u32be(20));
  }

  if (format === 'jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      // Standalone markers carry no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return ok(u16be(i + 7), u16be(i + 5));
      if (marker === 0xda || marker === 0xd9) return null;
      i += 2 + u16be(i + 2);
    }
    return null;
  }

  // WebP (RIFF container already checked by the caller's magic test).
  if (bytes.length < 30) return null;
  const chunk = ascii(12, 4);
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return ok(((bytes[27] << 8) | bytes[26]) & 0x3fff, ((bytes[29] << 8) | bytes[28]) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const b = bytes;
    const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
    const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    return ok(width, height);
  }
  if (chunk === 'VP8X') {
    const animated = (bytes[20] & 0x02) !== 0;
    if (animated) return null;
    return ok(1 + u24le(24), 1 + u24le(27));
  }
  return null;
}
