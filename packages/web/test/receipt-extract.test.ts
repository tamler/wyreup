import { describe, expect, it } from 'vitest';
import {
  parseReceiptResult,
  receiptCsv,
  receiptRows,
  type ReceiptExtractResult,
} from '../src/components/runners/receiptExtract';
import { VARIANT_MAP } from '../src/components/runners/variantMap';

const result: ReceiptExtractResult = {
  engine: 'clairic',
  model: '@cf/cloudflare/clairic',
  hasConfidence: true,
  truncated: false,
  fields: [
    {
      name: 'vendor',
      label: 'Vendor',
      type: 'text',
      value: '=Acme, "Inc"',
      missing: false,
      confidence: 0.991,
      pNull: 0,
    },
    {
      name: 'total',
      label: 'Total',
      type: 'number',
      value: 1080,
      missing: false,
      confidence: 0.62,
      pNull: 0,
    },
    {
      name: 'tax',
      label: 'Tax',
      type: 'number',
      value: null,
      missing: true,
      confidence: 0.9,
      pNull: 0.9,
    },
    {
      name: 'line_items',
      label: 'Line items',
      type: 'list',
      value: ['4 pallets', 'Shipping, ground'],
      missing: false,
      confidence: 0.9,
      pNull: null,
    },
  ],
  data: {},
};

describe('receipt extractor display helpers', () => {
  it('routes the tool to its own runner', () => {
    expect(VARIANT_MAP['receipt-extract-pro']).toBe('ReceiptExtractRunner');
  });

  it('formats rows with missing and low-confidence flags', () => {
    const rows = receiptRows(result);
    expect(rows[1]).toMatchObject({
      label: 'Total',
      value: '1,080.00',
      confidence: '62%',
      low: true,
    });
    expect(rows[2]).toMatchObject({ missing: true, low: false });
    expect(rows[3].value).toBe('4 pallets\nShipping, ground');
  });

  it('writes CSV with one row per line item and neutralised formulas', () => {
    expect(receiptCsv(result).split('\r\n')).toEqual([
      'field,value,missing,confidence',
      `vendor,"'=Acme, ""Inc""",false,0.991`,
      'total,1080,false,0.62',
      'tax,,true,0.9',
      'line_items[1],4 pallets,false,0.9',
      'line_items[2],"Shipping, ground",false,0.9',
      '',
    ]);
  });

  it('leaves confidence blank for fallback results', () => {
    const fallback = {
      ...result,
      engine: 'fallback' as const,
      hasConfidence: false,
      fields: result.fields.map((f) => ({ ...f, confidence: null })),
    };
    expect(receiptCsv(fallback).split('\r\n')[2]).toBe('total,1080,false,');
    expect(receiptRows(fallback)[1]).toMatchObject({ confidence: '', low: false });
  });

  it('rejects an unexpected result shape', () => {
    expect(() => parseReceiptResult('{"engine":"other","fields":[]}')).toThrow();
    expect(parseReceiptResult(JSON.stringify(result)).engine).toBe('clairic');
  });
});
