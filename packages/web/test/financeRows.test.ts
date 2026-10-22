import { describe, expect, it } from 'vitest';
import {
  decodeFinanceRows,
  encodeFinanceRows,
  financeRowContract,
  newFinanceRow,
  parseFinanceRowsCsv,
  validateFinanceRows,
} from '../src/components/runners/financeRows';
const discount = financeRowContract('discount-calculator', 'discountRatesJson')!;
const recipe = financeRowContract('recipe-cost-calculator', 'ingredientsJson')!;
describe('finance structured row inputs', () => {
  it('starts required rate cells blank and serializes only validated typed rows', () => {
    expect(newFinanceRow(discount)).toEqual({ percent: null });
    expect(() => encodeFinanceRows([newFinanceRow(discount)], discount)).toThrow(/finite/i);
    expect(encodeFinanceRows([{ percent: 20 }, { percent: 10 }], discount)).toBe(
      '[{"percent":20},{"percent":10}]',
    );
  });
  it('parses quoted CSV/TSV with exact headers and preserves names as literal strings', () => {
    const parsed = parseFinanceRowsCsv(
      'name,packageCost,packageQuantity,usedQuantity,unit\n"Flour, plain",10,1000,200,g',
      'comma',
      recipe,
    );
    expect(parsed).toEqual([
      {
        name: 'Flour, plain',
        packageCost: 10,
        packageQuantity: 1000,
        usedQuantity: 200,
        unit: 'g',
        wastePercent: 0,
      },
    ]);
    expect(parseFinanceRowsCsv('percent\n20\n10', 'comma', discount)).toEqual([
      { percent: 20 },
      { percent: 10 },
    ]);
    expect(
      parseFinanceRowsCsv(
        'name\tpackageCost\tpackageQuantity\tusedQuantity\tunit\n<script>\t6\t12\t2\teggs',
        'tab',
        recipe,
      )[0]?.name,
    ).toBe('<script>');
  });
  it('rejects implicit number guesses, blank numeric cells, unknown/duplicate headers and ragged rows', () => {
    for (const cell of ['', '$20', '20%', '1e2', 'false', 'null', '1,000', ' 20 '])
      expect(() => parseFinanceRowsCsv(`percent\n"${cell}"`, 'comma', discount)).toThrow();
    expect(() => parseFinanceRowsCsv('Percent\n20', 'comma', discount)).toThrow(/headers/i);
    expect(() => parseFinanceRowsCsv('percent,percent\n20,10', 'comma', discount)).toThrow(
      /headers/i,
    );
    expect(() => parseFinanceRowsCsv('percent\n20,10', 'comma', discount)).toThrow();
  });
  it('validates strict band fenceposts and requires a final explicit remaining row', () => {
    const contract = financeRowContract('amazon-fba-profit-calculator', 'feeBandsJson')!;
    expect(
      validateFinanceRows([{ upperBound: 100, percent: 10 }, { percent: 5 }], contract),
    ).toEqual([{ upperBound: 100, percent: 10 }, { percent: 5 }]);
    for (const value of [
      [{ upperBound: 100, percent: 10 }],
      [{ upperBound: 100, percent: 10 }, { upperBound: 90, percent: 5 }, { percent: 2 }],
      [{ upperBound: null, percent: 10 }],
    ])
      expect(() => validateFinanceRows(value, contract)).toThrow();
  });
  it('enforces failure counts and paired payment overrides with exact row contracts', () => {
    const contract = financeRowContract('patreon-earnings-calculator', 'tiersJson')!;
    expect(decodeFinanceRows('[{"members":2,"monthlyPrice":10}]', contract)).toEqual([
      { members: 2, monthlyPrice: 10, failedMembers: 0, taxPerMember: 0 },
    ]);
    expect(() =>
      validateFinanceRows([{ members: 2, monthlyPrice: 10, failedMembers: 3 }], contract),
    ).toThrow(/failed/i);
    expect(() =>
      validateFinanceRows([{ members: 2, monthlyPrice: 10, paymentPercent: 5 }], contract),
    ).toThrow(/both/i);
    expect(() =>
      validateFinanceRows(
        [
          { members: 1000000, monthlyPrice: 10 },
          { members: 1, monthlyPrice: 10 },
        ],
        contract,
      ),
    ).toThrow(/combined/i);
  });
  it('rejects malformed, oversized, unknown, nonfinite and accessor row data without invoking accessors', () => {
    expect(() => decodeFinanceRows('{broken', discount)).toThrow(/JSON/i);
    expect(() => decodeFinanceRows(' '.repeat(100001), discount)).toThrow(/bounded/i);
    expect(() => validateFinanceRows([{ percent: 20, extra: 1 }], discount)).toThrow(/unknown/i);
    expect(() => validateFinanceRows([{ percent: Infinity }], discount)).toThrow();
    let called = false;
    const hostile = Object.defineProperty({}, 'percent', {
      enumerable: true,
      get() {
        called = true;
        return 10;
      },
    });
    expect(() => validateFinanceRows([hostile], discount)).toThrow(/data/i);
    expect(called).toBe(false);
    expect(() => validateFinanceRows(new Array(101).fill({ percent: 1 }), discount)).toThrow(
      /100/i,
    );
  });
});
