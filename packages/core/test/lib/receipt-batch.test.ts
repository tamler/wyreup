import { describe, expect, it } from 'vitest';
import { parseReceiptBatch, receiptBatchCsv } from '../../src/lib/receipt-batch.js';

const sample = {
  version: 1,
  receipts: [{ sourceIndex: 0, merchant: '=HYPERLINK("https://example.com")', date: '2026-11-13', currency: 'USD', subtotal: '4.00', tax: null, total: '-3.25', lines: [{ description: '  +malicious', quantity: '1', amount: '-3.25' }], evidence: { total: 'Total -3.25' }, warnings: ['Check totals'] }],
};

describe('receipt batch export', () => {
  it('quotes and neutralizes untrusted text without corrupting negative decimals', () => {
    const parsed = parseReceiptBatch(sample);
    const csv = receiptBatchCsv(parsed);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain("'  +malicious");
    expect(csv).toContain(',-3.25,');
  });

  it('rejects injected numeric cells, oversized collections and unknown fields', () => {
    expect(() => parseReceiptBatch({ ...sample, receipts: [{ ...sample.receipts[0], total: '=2+2' }] })).toThrow(/decimal/);
    expect(() => parseReceiptBatch({ ...sample, receipts: Array(4).fill(sample.receipts[0]) })).toThrow(/1 to 3/);
    expect(() => parseReceiptBatch({ ...sample, receipts: [{ ...sample.receipts[0], hidden: true }] })).toThrow(/unexpected/i);
  });

  it('emits totals once in a summary row and keeps line rows separate', () => {
    const csv = receiptBatchCsv({ ...sample, receipts: [{ ...sample.receipts[0], lines: [sample.receipts[0]!.lines[0], sample.receipts[0]!.lines[0]] }] });
    const lines = csv.split('\r\n');
    expect(lines[0]).toMatch(/^\ufeffsource,row_type,/);
    expect(lines.filter(line => line.includes(',summary,'))).toHaveLength(1);
    expect(lines.filter(line => line.includes(',line,'))).toHaveLength(2);
    expect(lines[1]).toContain(',-3.25,');
    expect(lines[2]).toContain(',line,,,,,,,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('guards full-width and whitespace-prefixed formulas and quotes literal cells', () => {
    const csv = receiptBatchCsv({ ...sample, receipts: [{ ...sample.receipts[0], merchant: '\t＝1+1', lines: [{ description: 'Quote, "x"\nline', quantity: null, amount: null }] }] });
    expect(csv).toContain('"\'\t＝1+1"');
    expect(csv).toContain('"Quote, ""x""\nline"');
    expect(csv).toContain('"\'2026-11-13"');
    expect(csv).toContain('"\'USD"');
  });

  it.each(['@cmd', '\ttext', '\rtext', ' \ttext', ' \rtext', ' \u0001text', ' \u007ftext', '\ufeff=cmd', '＋cmd', '－cmd', '＠cmd'])('neutralizes dangerous text prefix %j', merchant => {
    const csv = receiptBatchCsv({ ...sample, receipts: [{ ...sample.receipts[0], merchant }] });
    expect(csv).toContain(`"'${merchant}"`);
  });

  it.each(['01', '1.', '1e3', '1.23456', '3,25', '123456789012345.1'])('rejects unsafe or ambiguous decimal %s', amount => {
    expect(() => parseReceiptBatch({ ...sample, receipts: [{ ...sample.receipts[0], total: amount }] })).toThrow(/decimal/i);
  });

  it('accepts negative zero and exports a receipt without lines', () => {
    const csv = receiptBatchCsv({ ...sample, receipts: [{ ...sample.receipts[0], total: '-0.00', lines: [] }] });
    expect(csv).toContain(',-0.00,');
    expect(csv).not.toContain(',line,');
  });

  it('loads blank model lines for editing but refuses them on export', () => {
    const value = { ...sample, receipts: [{ ...sample.receipts[0], lines: [{ description: null, quantity: null, amount: null }] }] };
    expect(parseReceiptBatch(value).receipts[0]!.lines).toHaveLength(1);
    expect(() => receiptBatchCsv(value)).toThrow(/Enter a description, quantity or amount/);
  });

  it('explains how to correct values exceeding 15 significant digits', () => {
    expect(() => receiptBatchCsv({ ...sample, receipts: [{ ...sample.receipts[0], total: '123456789012345.1' }] })).toThrow(/fewer digits/i);
  });

  it.each([
    { ...sample, version: 2 },
    { ...sample, receipts: [] },
    { ...sample, receipts: [{ ...sample.receipts[0], sourceIndex: 2 }] },
    { ...sample, receipts: [sample.receipts[0], sample.receipts[0]] },
    { ...sample, receipts: [{ ...sample.receipts[0], lines: Array(21).fill(sample.receipts[0]!.lines[0]) }] },
    { ...sample, receipts: [{ ...sample.receipts[0], warnings: [3] }] },
    { ...sample, receipts: [{ ...sample.receipts[0], evidence: { other: 'x' } }] },
    { ...sample, receipts: [{ ...sample.receipts[0], merchant: 'a'.repeat(2001) }] },
  ])('rejects invalid bounded schema %#', value => {
    expect(() => parseReceiptBatch(value)).toThrow();
  });
});
