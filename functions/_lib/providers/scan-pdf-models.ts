// Scanned-PDF question answering (pdf-scan-q-and-a-pro).
//
// The browser renders up to SCAN_PDF_MAX_PAGES pages of a PDF to JPEG and
// sends those page images plus one question. This module validates that
// untrusted input and makes exactly one Workers AI vision call: no retries,
// no fallback model. Every number that bounds the run's cost lives here so
// the margin test (functions/_lib/pricing-margin.test.ts) stays honest
// when a cap changes.

import type { Env } from '../env';
import { withTimeout } from '../timeout';

export const SCAN_PDF_MODEL = '@cf/google/gemma-4-26b-a4b-it';

/** Most page images accepted per run. */
export const SCAN_PDF_MAX_PAGES = 10;
/** Decoded size cap per page image. A 1536 px JPEG page is far smaller. */
export const SCAN_PDF_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Longest question accepted, in characters. */
export const SCAN_PDF_MAX_QUESTION_CHARS = 2_000;
/** Output cap sent as max_completion_tokens. */
export const SCAN_PDF_MAX_OUTPUT_TOKENS = 2_048;
/**
 * Conservative per-image input token bound. Gemma 4 caps an image at its
 * largest visual token budget (1,120 soft tokens); 2,048 leaves room for
 * image delimiter tokens and any provider-side accounting we cannot see.
 */
export const SCAN_PDF_TOKENS_PER_IMAGE_BOUND = 2_048;
/** Total page-label characters the runner can add (10 labels, generous). */
const PAGE_LABEL_CHARS_BOUND = 400;
/** Chat template overhead per run, in tokens (role markers, BOS, etc.). */
const TEMPLATE_TOKENS_BOUND = 500;
/** Calls the runner can make per run, billed or not. */
export const SCAN_PDF_CALLS_PER_RUN = 1;

// Cloudflare list price for gemma-4-26b-a4b-it (verified 2026-11-11).
const USD_PER_M_INPUT = 0.1;
const USD_PER_M_OUTPUT = 0.3;

const TIMEOUT_MS = 90_000;

export const SCAN_PDF_SYSTEM_PROMPT =
  'You answer questions about scanned document pages shown as images. ' +
  'Read the pages carefully, including tables, stamps and handwriting. ' +
  'Use only what is visible on the pages. If the answer is not on these pages, say so plainly. ' +
  'When it helps, say which page the answer came from. Return only the answer, no preamble.';

/**
 * Worst-case Cloudflare cost of one run in USD: every page at the cap, the
 * longest question, the full output cap, and every call the runner makes.
 * Text is bounded at 1 token per 3 characters.
 */
export function scanPdfWorstCaseUsd(): number {
  const textChars =
    SCAN_PDF_SYSTEM_PROMPT.length + SCAN_PDF_MAX_QUESTION_CHARS + PAGE_LABEL_CHARS_BOUND;
  const inputTokens =
    SCAN_PDF_MAX_PAGES * SCAN_PDF_TOKENS_PER_IMAGE_BOUND +
    Math.ceil(textChars / 3) +
    TEMPLATE_TOKENS_BOUND;
  const perCall =
    (inputTokens * USD_PER_M_INPUT + SCAN_PDF_MAX_OUTPUT_TOKENS * USD_PER_M_OUTPUT) / 1_000_000;
  return perCall * SCAN_PDF_CALLS_PER_RUN;
}

export interface ScanPdfPage {
  /** 1-indexed page number in the source PDF, used to label the image. */
  page: number;
  /** data:image/jpeg|png|webp;base64,... */
  dataUrl: string;
}

export interface ScanPdfInput {
  question: string;
  pages: ScanPdfPage[];
}

/** Validates untrusted client input. Throws with a user-facing message. */
export function readScanPdfInput(raw: Record<string, unknown>): ScanPdfInput {
  const q = raw.question;
  if (typeof q !== 'string' || q.trim().length === 0) {
    throw new Error("'question' (non-empty string) is required");
  }
  if (q.length > SCAN_PDF_MAX_QUESTION_CHARS) {
    throw new Error(`'question' exceeds ${SCAN_PDF_MAX_QUESTION_CHARS} characters`);
  }
  const list = raw.pages;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("'pages' (non-empty array of page images) is required");
  }
  if (list.length > SCAN_PDF_MAX_PAGES) {
    throw new Error(`At most ${SCAN_PDF_MAX_PAGES} pages per run`);
  }
  const seen = new Set<number>();
  const pages = list.map((entry): ScanPdfPage => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Each page must be an object with page and image');
    }
    const { page, image } = entry as { page?: unknown; image?: unknown };
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100_000) {
      throw new Error('Each page needs a positive integer page number');
    }
    if (seen.has(page)) throw new Error(`Page ${page} was sent twice`);
    seen.add(page);
    return { page, dataUrl: readPageImage(image) };
  });
  return { question: q.trim(), pages };
}

function readPageImage(v: unknown): string {
  const maxB64 = Math.ceil(SCAN_PDF_MAX_IMAGE_BYTES / 3) * 4;
  if (typeof v !== 'string') throw new Error('Each page image must be a data URL');
  const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(v);
  if (!prefix) throw new Error('Each page image must be a PNG, JPEG or WebP data URL');
  const b64 = v.slice(prefix[0].length);
  if (!b64 || b64.length > maxB64) {
    throw new Error(`Each page image must be under ${SCAN_PDF_MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('Invalid page image base64');
  // Only the header is needed to check the format; decode a short prefix.
  let head: string;
  try {
    head = atob(b64.slice(0, 16));
  } catch {
    throw new Error('Invalid page image base64');
  }
  if (sniff(head) !== prefix[1])
    throw new Error('Page image bytes do not match the declared format');
  return v;
}

function sniff(h: string): 'png' | 'jpeg' | 'webp' | null {
  const b = (i: number) => h.charCodeAt(i);
  if (h.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b(i) === x)) return 'png';
  if (h.length >= 3 && b(0) === 255 && b(1) === 216 && b(2) === 255) return 'jpeg';
  if (h.length >= 12 && h.slice(0, 4) === 'RIFF' && h.slice(8, 12) === 'WEBP') return 'webp';
  return null;
}

type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Builds the single chat request sent to the vision model. */
export function buildScanPdfRequest(input: ScanPdfInput) {
  const content: ContentPart[] = [];
  for (const p of input.pages) {
    content.push({ type: 'text', text: `Page ${p.page}:` });
    content.push({ type: 'image_url', image_url: { url: p.dataUrl } });
  }
  content.push({ type: 'text', text: `Question: ${input.question}` });
  return {
    messages: [
      { role: 'system', content: SCAN_PDF_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    max_completion_tokens: SCAN_PDF_MAX_OUTPUT_TOKENS,
    // Thinking tokens count against the output cap; keep the whole budget
    // for the answer.
    chat_template_kwargs: { enable_thinking: false },
  };
}

function readAnswer(res: unknown): string {
  const r = res as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const fromChoices = r?.choices?.[0]?.message?.content;
  const text =
    typeof fromChoices === 'string'
      ? fromChoices
      : typeof r?.response === 'string'
        ? r.response
        : '';
  const answer = text.trim();
  if (!answer) throw new Error('Vision model returned no answer');
  return answer;
}

/** Validates now, dispatches later (runner convention). */
export function prepareScanPdfQandA(raw: Record<string, unknown>, env: Env) {
  const input = readScanPdfInput(raw);
  return async () => {
    const res = await withTimeout(
      env.AI.run(SCAN_PDF_MODEL, buildScanPdfRequest(input)),
      TIMEOUT_MS,
      `vision-model (${SCAN_PDF_MODEL})`,
    );
    return { answer: readAnswer(res), pages: input.pages.map((p) => p.page) };
  };
}
