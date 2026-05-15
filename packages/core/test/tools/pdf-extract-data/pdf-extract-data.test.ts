import { describe, it, expect } from 'vitest';
import { extractFieldsFromText, pdfExtractData } from '../../../src/tools/pdf-extract-data/index.js';

describe('pdf-extract-data — metadata', () => {
  it('has id pdf-extract-data', () => {
    expect(pdfExtractData.id).toBe('pdf-extract-data');
  });
  it('is in the pdf category', () => {
    expect(pdfExtractData.category).toBe('pdf');
  });
  it('outputs application/json', () => {
    expect(pdfExtractData.output.mime).toBe('application/json');
  });
  it('declares free cost', () => {
    expect(pdfExtractData.cost).toBe('free');
  });
});

const SAMPLE_INVOICE = `Acme Co
123 Main Street
San Francisco, CA 94103

Invoice #INV-2026-0042
Date: 2026-05-14

Description                  Amount
Widget                       $19.99
Sprocket Mk II                $4.50
Shipping                      $3.99

Subtotal:                    $28.48
Tax:                          $2.50
Total: $30.98

Thank you for your business.`;

describe('extractFieldsFromText — full invoice', () => {
  it('detects the vendor from the first non-numeric line', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.vendor).toBe('Acme Co');
  });

  it('detects the invoice number', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.invoiceNumber).toBe('INV-2026-0042');
  });

  it('detects the date', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.date).toBe('2026-05-14');
  });

  it('detects the total via the "Total:" label', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.total?.value).toBe(30.98);
  });

  it('detects the subtotal', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.subtotal?.value).toBe(28.48);
  });

  it('detects tax', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.tax?.value).toBe(2.50);
  });

  it('extracts line items', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    const descs = r.lineItems.map((l) => l.description);
    expect(descs).toContain('Widget');
    expect(descs).toContain('Sprocket Mk II');
    expect(descs).toContain('Shipping');
  });

  it('excludes the total/subtotal/tax rows from line items', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    const descs = r.lineItems.map((l) => l.description.toLowerCase());
    expect(descs.some((d) => d.includes('total'))).toBe(false);
    expect(descs.some((d) => d.includes('subtotal'))).toBe(false);
    expect(descs.some((d) => d.includes('tax'))).toBe(false);
  });

  it('high confidence when all signals present', () => {
    const r = extractFieldsFromText(SAMPLE_INVOICE);
    expect(r.confidence).toBe('high');
    expect(r.warnings.length).toBe(0);
  });
});

describe('extractFieldsFromText — fallback total', () => {
  it('uses the largest currency amount when no label is present', () => {
    const text = `Some Vendor
Date: 2026-01-01
Item A $5
Item B $10
Item C $7`;
    const r = extractFieldsFromText(text);
    expect(r.total?.value).toBe(10);
  });
});

describe('extractFieldsFromText — alternate currency', () => {
  it('parses GBP when currency is £', () => {
    const text = `My Shop
Total: £42.50
Date: 2026-01-01`;
    const r = extractFieldsFromText(text, { currency: '£' });
    expect(r.total?.value).toBe(42.5);
  });
});

describe('extractFieldsFromText — alternate date formats', () => {
  it('detects US-format dates', () => {
    const r = extractFieldsFromText('Test\nDate: 05/14/2026\n');
    expect(r.date).toBe('05/14/2026');
  });

  it('detects long-form dates', () => {
    const r = extractFieldsFromText('Test\nDate: May 14, 2026\n');
    expect(r.date).toMatch(/May 14/);
  });
});

describe('extractFieldsFromText — missing signals', () => {
  it('returns low confidence and warnings when little is present', () => {
    const r = extractFieldsFromText('just some random text with no fields');
    expect(r.confidence).toBe('low');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const r = extractFieldsFromText('');
    expect(r.confidence).toBe('low');
    expect(r.lineItems.length).toBe(0);
  });
});
