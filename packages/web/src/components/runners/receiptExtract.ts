// Display and CSV helpers for ReceiptExtractRunner (receipt-extract-pro).
// The tool returns JSON; parseReceiptResult checks the shape before display.

export interface ReceiptField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'list';
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

export function parseReceiptResult(json: string): ReceiptExtractResult {
  const v = JSON.parse(json) as Partial<ReceiptExtractResult> | null;
  if (
    !v ||
    (v.engine !== 'clairic' && v.engine !== 'fallback') ||
    !Array.isArray(v.fields) ||
    !v.fields.every(
      (f) =>
        f &&
        typeof f.name === 'string' &&
        typeof f.label === 'string' &&
        typeof f.missing === 'boolean' &&
        (f.confidence === null || typeof f.confidence === 'number'),
    )
  )
    throw new Error('Unexpected result from the receipt extractor.');
  return v as ReceiptExtractResult;
}

export interface ReceiptRow {
  label: string;
  value: string;
  missing: boolean;
  /** "97%" or "" when the model gave no confidence. */
  confidence: string;
  /** True when a present value has confidence below 0.8. */
  low: boolean;
}

export const LOW_CONFIDENCE = 0.8;

export function formatValue(field: ReceiptField): string {
  if (field.value === null) return '';
  if (Array.isArray(field.value)) return field.value.join('\n');
  if (typeof field.value === 'number')
    return field.value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return field.value;
}

export function formatConfidence(c: number | null): string {
  return c === null ? '' : `${Math.round(c * 100)}%`;
}

export function receiptRows(result: ReceiptExtractResult): ReceiptRow[] {
  return result.fields.map((f) => ({
    label: f.label,
    value: formatValue(f),
    missing: f.missing,
    confidence: formatConfidence(f.confidence),
    low: !f.missing && f.confidence !== null && f.confidence < LOW_CONFIDENCE,
  }));
}

// Spreadsheet apps execute cells that start with these characters.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(v: string): string {
  const safe = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One row per field; each line item gets its own row. Numbers are written
 * unformatted so spreadsheets read them as numbers.
 */
export function receiptCsv(result: ReceiptExtractResult): string {
  const lines = [['field', 'value', 'missing', 'confidence'].join(',')];
  for (const f of result.fields) {
    const confidence = f.confidence === null ? '' : String(Math.round(f.confidence * 1000) / 1000);
    if (Array.isArray(f.value)) {
      f.value.forEach((item, i) =>
        lines.push([csvCell(`${f.name}[${i + 1}]`), csvCell(item), 'false', confidence].join(',')),
      );
      continue;
    }
    const value =
      f.value === null ? '' : typeof f.value === 'number' ? String(f.value) : csvCell(f.value);
    lines.push([csvCell(f.name), value, String(f.missing), confidence].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
