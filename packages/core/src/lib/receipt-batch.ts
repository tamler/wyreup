/** Offline validation and CSV export for the unfinished receipt feature. */
export interface ReceiptLine {
  description: string | null;
  quantity: string | null;
  amount: string | null;
}

export interface Receipt {
  sourceIndex: number;
  merchant: string | null;
  date: string | null;
  currency: string | null;
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  lines: ReceiptLine[];
  evidence: Record<string, string | null>;
  warnings: string[];
}

export interface ReceiptBatch { version: 1; receipts: Receipt[] }

export class ReceiptFieldError extends Error {
  constructor(public readonly fieldKey: string, message: string, public readonly code: 'invalid_field' | 'blank_line' = 'invalid_field') {
    super(message);
    this.name = 'ReceiptFieldError';
  }
}

function field<T>(key: string, read: () => T): T {
  try { return read(); }
  catch (error) {
    throw new ReceiptFieldError(key, error instanceof Error ? error.message : 'Invalid value');
  }
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error('Unexpected field');
  return result;
}

function text(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2_000) throw new Error('Invalid text. Use at most 2,000 characters.');
  return value;
}

function decimal(value: unknown): string | null {
  const result = text(value);
  if (result !== null && !/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(result)) {
    throw new Error('Invalid decimal. Use digits, an optional minus sign and a period; no commas or spaces. Use at most 4 decimal places.');
  }
  if (result !== null && result.replace(/[-.]/g, '').replace(/^0+/, '').length > 15) throw new Error('Decimal exceeds 15 significant digits; use fewer digits.');
  return result;
}

export function parseReceiptBatch(value: unknown): ReceiptBatch {
  const batch = object(value, ['version', 'receipts']);
  if (batch.version !== 1 || !Array.isArray(batch.receipts) || batch.receipts.length < 1 || batch.receipts.length > 3) {
    throw new Error('Expected version 1 with 1 to 3 receipts');
  }
  const rawReceipts: unknown[] = batch.receipts;
  const seen = new Set<number>();
  const receipts = rawReceipts.map((value, receiptIndex) => {
    const row = object(value, ['sourceIndex', 'merchant', 'date', 'currency', 'subtotal', 'tax', 'total', 'lines', 'evidence', 'warnings']);
    if (typeof row.sourceIndex !== 'number' || !Number.isInteger(row.sourceIndex) || row.sourceIndex < 0 || row.sourceIndex >= rawReceipts.length || seen.has(row.sourceIndex)) throw new Error('Invalid source index');
    seen.add(row.sourceIndex);
    if (!Array.isArray(row.lines) || row.lines.length > 20) throw new Error('Invalid lines');
    const lines = row.lines.map((value, lineIndex) => {
      const line = object(value, ['description', 'quantity', 'amount']);
      const key = (name: string) => `${receiptIndex}:line:${lineIndex}:${name}`;
      const result = { description: field(key('description'), () => text(line.description)), quantity: field(key('quantity'), () => decimal(line.quantity)), amount: field(key('amount'), () => decimal(line.amount)) };
      return result;
    });
    const evidenceRaw = object(row.evidence, ['merchant', 'date', 'currency', 'subtotal', 'tax', 'total']);
    const evidence: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(evidenceRaw)) evidence[key] = text(value);
    if (!Array.isArray(row.warnings) || row.warnings.length > 20 || !row.warnings.every(w => typeof w === 'string' && w.length <= 2_000)) throw new Error('Invalid warnings');
    const key = (name: string) => `${receiptIndex}:receipt:${name}`;
    return { sourceIndex: row.sourceIndex, merchant: field(key('merchant'), () => text(row.merchant)), date: field(key('date'), () => text(row.date)), currency: field(key('currency'), () => text(row.currency)), subtotal: field(key('subtotal'), () => decimal(row.subtotal)), tax: field(key('tax'), () => decimal(row.tax)), total: field(key('total'), () => decimal(row.total)), lines, evidence, warnings: row.warnings as string[] };
  });
  return { version: 1, receipts };
}

function csvText(value: string | null): string {
  let safe = value ?? '';
  let first = 0;
  let controlPrefix = false;
  while (first < safe.length && (safe.charCodeAt(first) <= 32 || safe.charCodeAt(first) === 127 || /\s/u.test(safe[first]!))) {
    if (safe.charCodeAt(first) < 32 || safe.charCodeAt(first) === 127) controlPrefix = true;
    first++;
  }
  if (controlPrefix || /^[=+\-@]/u.test((safe[first] ?? '').normalize('NFKC'))) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Revalidates edited input; decimal cells remain numeric, all other cells are quoted. */
export function receiptBatchCsv(value: unknown): string {
  const batch = parseReceiptBatch(value);
  const rows = ['source,row_type,merchant,date,currency,subtotal,tax,total,description,quantity,amount,evidence,warnings'];
  for (const [receiptIndex, receipt] of batch.receipts.entries()) {
    rows.push([String(receipt.sourceIndex), 'summary', csvText(receipt.merchant), csvText(receipt.date === null ? null : `'${receipt.date}`), csvText(receipt.currency === null ? null : `'${receipt.currency}`), receipt.subtotal ?? '', receipt.tax ?? '', receipt.total ?? '', '', '', '', csvText(JSON.stringify(receipt.evidence)), csvText(JSON.stringify(receipt.warnings))].join(','));
    for (const [lineIndex, line] of receipt.lines.entries()) {
      if (line.description === null && line.quantity === null && line.amount === null) {
        throw new ReceiptFieldError(`${receiptIndex}:line:${lineIndex}:description`, 'Enter a description, quantity or amount, or remove the blank line.', 'blank_line');
      }
      rows.push([String(receipt.sourceIndex), 'line', '', '', '', '', '', '', csvText(line.description), line.quantity ?? '', line.amount ?? '', '', ''].join(','));
    }
  }
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
