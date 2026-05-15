import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfExtractDataParams {
  /** Currency symbol expected in amounts. Defaults to '$' but accepts any single char or short prefix. */
  currency?: string;
}

export const defaultPdfExtractDataParams: PdfExtractDataParams = {
  currency: '$',
};

export interface MoneyValue {
  value: number;
  raw: string;
}

export interface PdfLineItem {
  description: string;
  amount?: MoneyValue;
}

export interface PdfExtractDataResult {
  vendor?: string;
  invoiceNumber?: string;
  date?: string;
  total?: MoneyValue;
  subtotal?: MoneyValue;
  tax?: MoneyValue;
  lineItems: PdfLineItem[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  rawText: string;
}

// ── PDF text extraction (mirrors pdf-to-text loading pattern) ─────────────

async function extractTextFromPdf(blob: Blob): Promise<string> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window === 'undefined') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    try {
      const workerPath: string = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      GlobalWorkerOptions.workerSrc = workerPath;
    } catch {
      GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';
    }
  }
  const buffer = await blob.arrayBuffer();
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as unknown[])
      .map((item) => {
        if (typeof item !== 'object' || item === null || !('str' in item)) return '';
        const s = (item as { str?: unknown }).str;
        return typeof s === 'string' ? s : '';
      })
      .join(' ')
      .replace(/ +/g, ' ')
      .trim();
    parts.push(pageText);
  }
  return parts.join('\n');
}

// ── Heuristics ─────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moneyPattern(currency: string): RegExp {
  // Matches the configured currency followed by a number with optional thousands separators and decimals,
  // OR a bare number followed by the currency, OR a parenthesised negative.
  const sym = escapeRegExp(currency);
  return new RegExp(
    `\\(?\\s*${sym}\\s?-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?\\)?|\\(?\\s*-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?\\s?${sym}\\)?`,
    'g',
  );
}

function parseMoney(raw: string, currency: string): MoneyValue | null {
  const negative = /\(.*\)/.test(raw);
  const stripped = raw.replace(currency, '').replace(/[(),\s]/g, '');
  const n = parseFloat(stripped);
  if (!Number.isFinite(n)) return null;
  return { value: negative ? -Math.abs(n) : n, raw: raw.trim() };
}

const DATE_PATTERNS: RegExp[] = [
  // ISO: 2026-05-14
  /\b\d{4}-\d{2}-\d{2}\b/g,
  // US: 5/14/2026 or 05-14-26
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  // Long form: May 14, 2026 / May 14 2026
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/g,
  // Day-first: 14 May 2026
  /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/g,
];

function findDates(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const re of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
    }
  }
  return out;
}

function findLabelledMoney(text: string, labels: string[], currency: string): MoneyValue | null {
  const sym = escapeRegExp(currency);
  for (const label of labels) {
    // \b prevents "Total" from matching inside "Subtotal".
    const re = new RegExp(`\\b${escapeRegExp(label)}\\s*:?\\s*(\\(?\\s*${sym}?\\s?-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?\\s?${sym}?\\)?)`, 'i');
    const m = re.exec(text);
    if (m) {
      const parsed = parseMoney(m[1]!, currency);
      if (parsed) return parsed;
    }
  }
  return null;
}

function findInvoiceNumber(text: string): string | undefined {
  const patterns = [
    /(?:invoice|receipt|order|reference|ref)\s*(?:#|no\.?|number)?\s*[:-]?\s*([A-Za-z0-9\-_/]{2,30})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1] && !/^(date|number|no)$/i.test(m[1])) return m[1];
  }
  return undefined;
}

function findVendor(text: string): string | undefined {
  // First non-empty line that doesn't look like a date, money, or invoice number.
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.length < 2 || line.length > 80) continue;
    if (/^\d/.test(line)) continue;
    if (/invoice|receipt|order/i.test(line)) continue;
    if (/^[$£€¥]/.test(line)) continue;
    return line;
  }
  return undefined;
}

function findLineItems(text: string, currency: string): PdfLineItem[] {
  const sym = escapeRegExp(currency);
  const re = new RegExp(`^(.+?)\\s+(\\(?\\s*${sym}\\s?-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?\\)?)\\s*$`, 'gm');
  const out: PdfLineItem[] = [];
  let m: RegExpExecArray | null;
  // Tokens we'd want to *exclude* (totals, subtotals — those are reported separately).
  const skip = /\b(total|subtotal|tax|vat|due|balance|payable)\b/i;
  while ((m = re.exec(text)) !== null) {
    const desc = m[1]!.trim();
    if (skip.test(desc)) continue;
    if (desc.length < 2 || desc.length > 200) continue;
    const amount = parseMoney(m[2]!, currency);
    out.push({ description: desc, ...(amount ? { amount } : {}) });
  }
  return out;
}

/**
 * Pure heuristic extraction from already-extracted text. Exposed for testing
 * (no need to construct a real PDF) and for callers who have the text in hand.
 */
export function extractFieldsFromText(
  text: string,
  params: PdfExtractDataParams = {},
): PdfExtractDataResult {
  const currency = params.currency ?? '$';

  // All currency amounts in document — used for fallback "biggest = total" heuristic.
  const moneyRe = moneyPattern(currency);
  const allMatches = Array.from(text.matchAll(moneyRe))
    .map((m) => parseMoney(m[0], currency))
    .filter((x): x is MoneyValue => x !== null);

  const total =
    findLabelledMoney(text, ['Total', 'Amount Due', 'Amount due', 'Grand Total', 'Balance Due'], currency) ??
    (allMatches.length > 0
      ? allMatches.reduce((max, m) => (Math.abs(m.value) > Math.abs(max.value) ? m : max), allMatches[0]!)
      : null);
  const subtotal = findLabelledMoney(text, ['Subtotal', 'Sub-total', 'Sub total'], currency);
  const tax = findLabelledMoney(text, ['Tax', 'Sales Tax', 'Sales tax', 'VAT', 'GST'], currency);

  const dates = findDates(text);
  const date = dates[0];
  const invoiceNumber = findInvoiceNumber(text);
  const vendor = findVendor(text);
  const lineItems = findLineItems(text, currency);

  const warnings: string[] = [];
  if (!total) warnings.push('No total amount detected.');
  if (!date) warnings.push('No date detected.');
  if (!vendor) warnings.push('No vendor detected from the first lines.');
  if (lineItems.length === 0) warnings.push('No line items detected.');

  // Confidence: 3 strong signals → high, 2 → medium, ≤1 → low.
  const strongSignals = [total, date, vendor, lineItems.length > 0 ? 1 : null].filter(Boolean).length;
  const confidence: PdfExtractDataResult['confidence'] = strongSignals >= 3 ? 'high' : strongSignals >= 2 ? 'medium' : 'low';

  const result: PdfExtractDataResult = {
    lineItems,
    confidence,
    warnings,
    rawText: text,
  };
  if (vendor) result.vendor = vendor;
  if (invoiceNumber) result.invoiceNumber = invoiceNumber;
  if (date) result.date = date;
  if (total) result.total = total;
  if (subtotal) result.subtotal = subtotal;
  if (tax) result.tax = tax;
  return result;
}

export async function extractPdfData(
  blob: Blob,
  params: PdfExtractDataParams = {},
): Promise<PdfExtractDataResult> {
  const text = await extractTextFromPdf(blob);
  return extractFieldsFromText(text, params);
}

export const pdfExtractData: ToolModule<PdfExtractDataParams> = {
  id: 'pdf-extract-data',
  slug: 'pdf-extract-data',
  name: 'PDF Extract Data',
  description:
    'Extract structured fields from invoice / receipt PDFs — vendor, invoice number, date, total, subtotal, tax, and line items. Pure heuristic: regex over the extracted text, no LLM, runs in your browser. Output is JSON.',
  llmDescription:
    'Take an invoice or receipt PDF, return JSON with detected fields: vendor (first non-numeric line), invoiceNumber (after Invoice/Order/Reference labels), date (first ISO / US / long-form date), total (after Total / Amount Due labels, or fallback to largest currency value), subtotal, tax, and line items (description + amount pairs). Includes a confidence score and warnings for missing fields.',
  category: 'pdf',
  keywords: ['pdf', 'invoice', 'receipt', 'extract', 'data', 'structured', 'fields', 'total', 'parse'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultPdfExtractDataParams,

  paramSchema: {
    currency: {
      type: 'string',
      label: 'currency symbol',
      placeholder: '$',
      maxLength: 4,
      help: 'Currency symbol to match in amounts. Default $.',
    },
  },

  async run(inputs: File[], params: PdfExtractDataParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('pdf-extract-data accepts exactly one PDF.');
    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Extracting PDF text' });
    const result = await extractPdfData(inputs[0]!, params);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  seoContent: {
    intro:
      'Drop an invoice or receipt PDF and get back structured JSON — vendor, invoice number, date, total, subtotal, tax, and a list of line items with their amounts. Pure heuristic: pdf.js extracts the text in your browser, then a labelled-money + date + line-item pass identifies the fields. No model download, no upload, no cost per call. The PDF never leaves your device.',
    useCases: [
      'Pull totals and dates out of a folder of receipts for expense reporting.',
      'Bootstrap a small bookkeeping pipeline without paying per-invoice to a hosted API.',
      'Verify what a vendor charged you against what your accounting software shows.',
      'Quickly diff two invoices from the same vendor by extracting both and comparing JSON.',
      'Feed structured invoice fields into a Wyreup chain (e.g., extract → csv-template → render report).',
    ],
    faq: [
      {
        q: 'Will it work on any invoice?',
        a: 'It works best on text-based PDFs (the kind your accounting software exports). Scanned image-only PDFs need OCR first — chain through `ocr-pro` or `pdf-vision-ocr`. The heuristics are tuned for English-language invoices using `$`, `£`, `€`, or similar currency symbols.',
      },
      {
        q: 'How accurate is the total detection?',
        a: 'Two passes: first looks for labelled amounts ("Total:", "Amount Due", "Grand Total"), then falls back to the largest currency value in the document. On well-structured invoices accuracy is high; on unusual layouts (e.g., totals embedded in narrative text) results may be off. The `confidence` field and `warnings` list flag low-confidence extractions.',
      },
      {
        q: 'Does it support non-USD currencies?',
        a: 'Yes — set the currency symbol parameter to `£`, `€`, `¥`, or any short prefix. The detection logic works the same way for any single-symbol currency.',
      },
      {
        q: 'Is anything sent to a server?',
        a: 'No. PDF parsing (pdf.js), heuristics, and the entire extraction run in your browser. You can disconnect your network mid-extraction and it still finishes.',
      },
      {
        q: 'Can it extract line items?',
        a: 'Yes — any row that ends in a currency value and isn\'t the total/subtotal/tax becomes a line item. The description is everything before the amount; the amount is parsed into a structured `{ value, raw }` object.',
      },
    ],
    alsoTry: [
      { id: 'pdf-to-text', why: 'Just want the raw text without structured extraction.' },
      { id: 'pdf-extract-tables', why: 'Extract every table in the PDF, not just invoice-shaped fields.' },
      { id: 'csv-template', why: 'Feed the extracted fields into a CSV report.' },
    ],
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
