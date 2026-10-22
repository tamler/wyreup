import { describe, expect, it } from 'vitest';
import {
  financeCell,
  financeSourceHref,
  financeSummaryText,
  financeTablePage,
  prepareFinanceResult,
} from '../src/components/runners/financeResults';
describe('readable complete finance results', () => {
  it('keeps all 1200 schedule rows while paginating the rendered selection', () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      month: i + 1,
      payment: 1,
      balance: 1199 - i,
    }));
    const view = prepareFinanceResult(JSON.stringify({ schedule: rows, totalPaid: 1200 }));
    expect(view.tables[0]?.rows).toHaveLength(1200);
    expect(financeTablePage(view.tables[0], 0)).toHaveLength(25);
    expect(financeTablePage(view.tables[0], 47)).toHaveLength(25);
    expect(financeTablePage(view.tables[0], 47).at(-1)).toMatchObject({ month: 1200, balance: 0 });
    expect(view.summary).toContainEqual({ label: 'Total Paid', value: 1200 });
  });
  it('renders row-string inputs as readable tables and preserves hostile data literally', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const view = prepareFinanceResult(
      JSON.stringify({
        inputs: { ingredientsJson: JSON.stringify([{ name: hostile, unit: 'g', packageCost: 1 }]) },
        note: hostile,
        profit: -1,
        margin: null,
      }),
    );
    expect(view.tables[0]?.rows[0]?.name).toBe(hostile);
    expect(view.summary).toContainEqual({ label: 'Note', value: hostile });
    expect(view.summary).toContainEqual({ label: 'Margin', value: 'Not defined (zero revenue)' });
    expect(financeSummaryText(view)).toContain('Margin: Not defined (zero revenue)');
    expect(financeSummaryText(view)).toContain(`Note: ${hostile}`);
    expect(financeCell(null)).toBe('Undefined');
    expect(financeCell(-1)).toBe('-1');
  });
  it('links only explicit official HTTPS hosts and preserves rejected sources as plain text', () => {
    expect(financeSourceHref('https://stripe.com/pricing')).toBe('https://stripe.com/pricing');
    for (const url of [
      'javascript:alert(1)',
      'http://stripe.com/pricing',
      'https://stripe.com.evil.test/',
      'https://attacker@stripe.com/',
      'https://stripe.com:444/',
    ])
      expect(financeSourceHref(url)).toBeNull();
    const view = prepareFinanceResult(
      JSON.stringify({
        sources: [{ title: 'Bad URL', url: 'javascript:alert(1)', checkedOn: '2026-10-11' }],
        limitations: ['Entered assumptions'],
      }),
    );
    expect(view.sources[0]).toMatchObject({ href: null, url: 'javascript:alert(1)' });
    expect(view.limitations).toEqual(['Entered assumptions']);
  });
  it('rejects invalid/unbounded results and invalid page controls instead of truncating artifacts', () => {
    expect(() => prepareFinanceResult('[1]')).toThrow(/object/i);
    expect(() => prepareFinanceResult('{broken')).toThrow(/JSON/i);
    expect(() =>
      prepareFinanceResult(JSON.stringify({ rows: Array.from({ length: 20001 }, () => 1) })),
    ).toThrow(/bounded/i);
    const table = prepareFinanceResult('{"rows":[1]}').tables[0];
    expect(() => financeTablePage(table, -1)).toThrow(/page/i);
    expect(() => financeTablePage(table, 0, 101)).toThrow(/page/i);
  });
});
