import { describe, expect, it } from 'vitest';
import {
  bankDefaults,
  exportBankStatement,
  extractBankStatement,
  parseBankDate,
  parseBankMoney,
  reviewBankStatement,
  validateBankDocument,
  validateBankParams,
  type BankDocument,
  type BankLine,
  type BankLineDecision,
  type BankParams,
} from '../../src/utilities/bank-statement';
import { parseCsv } from '../../src/utilities/csv-data';

function line(page: number, index: number, y: number, cells: [number, string][]): BankLine {
  return {
    id: `p${page}-l${index}`,
    page,
    line: index,
    y,
    text: cells.map(([, s]) => s).join(' '),
    items: cells.map(([x, text]) => ({ x, y, text, width: text.length * 2, height: 10 })),
  };
}
export function knownBankDocument(): BankDocument {
  return {
    rowTolerance: 2,
    pages: [
      { page: 1, width: 600, height: 800, visual: 'text' },
      { page: 2, width: 600, height: 800, visual: 'text' },
    ],
    lines: [
      line(1, 1, 760, [
        [120, 'Opening balance'],
        [440, '1000.00'],
      ]),
      line(1, 2, 700, [
        [35, '2026-01-01'],
        [120, 'Card purchase'],
        [360, '-12.34'],
        [440, '987.66'],
      ]),
      line(1, 3, 680, [[120, 'continued note']]),
      line(1, 4, 650, [
        [35, '2026-01-02'],
        [120, 'Deposit'],
        [360, '25.00'],
        [440, '1012.66'],
      ]),
      line(2, 1, 700, [
        [35, '2026-01-03'],
        [120, 'Transfer'],
        [360, '-100.00'],
        [440, '912.66'],
      ]),
      line(2, 2, 650, [
        [120, 'Closing balance'],
        [440, '912.66'],
      ]),
    ],
  };
}
function params(document = knownBankDocument()): BankParams {
  return {
    ...structuredClone(bankDefaults),
    opening: '1000.00',
    closing: '912.66',
    acknowledged: true,
    lineDecisions: document.lines
      .map((l): BankLineDecision => ({
        id: l.id,
        decision: 'accept',
        role: l.id === 'p1-l1' ? 'opening' : l.id === 'p2-l2' ? 'closing' : 'transaction',
      }))
      .map((d) =>
        d.id === 'p1-l3'
          ? { ...d, decision: 'attach', role: 'non-financial', attachTo: 'p1-l2' }
          : d,
      ),
  };
}
function reopened(csv: string): Record<string, string>[] {
  const table = parseCsv(new TextEncoder().encode(csv), { delimiter: 'comma', hasHeader: true });
  return table.rows.map((r) =>
    Object.fromEntries(table.columns.map((c, i) => [c.label, r.cells[i]!])),
  );
}
describe('exact bank amounts and dates', () => {
  it.each(['already-aborted', 'invalid-bytes'])(
    'releases a supplied owned PDF environment on %s',
    async (kind) => {
      let destroyed = 0;
      const controller = new AbortController();
      if (kind === 'already-aborted') controller.abort();
      await expect(
        extractBankStatement(new TextEncoder().encode('invalid'), 2, controller.signal, {
          open() {
            throw new Error('must not open');
          },
          paintOps: [],
          imageOps: [],
          destroy() {
            destroyed++;
          },
        }),
      ).rejects.toThrow();
      expect(destroyed).toBe(1);
    },
  );
  it('parses exact grouped decimal strings without floats or double signs', () => {
    expect(parseBankMoney('12.3', bankDefaults)).toBe('12.30');
    expect(parseBankMoney('-12.34', bankDefaults)).toBe('-12.34');
    expect(parseBankMoney('1.234,5', { ...bankDefaults, decimal: 'comma', grouping: 'dot' })).toBe(
      '1234.50',
    );
    expect(
      parseBankMoney('(1,234.56)', {
        ...bankDefaults,
        grouping: 'comma',
        signConvention: 'parentheses',
      }),
    ).toBe('-1234.56');
    expect(parseBankMoney('12.34 DR', { ...bankDefaults, signConvention: 'cr-dr' })).toBe('-12.34');
    expect(
      parseBankMoney('12.34 CR', {
        ...bankDefaults,
        signConvention: 'cr-dr',
        crMeaning: 'negative',
      }),
    ).toBe('-12.34');
    expect(parseBankMoney('10000000000000.00', bankDefaults)).toBe('10000000000000.00');
  });
  it.each([
    '1e2',
    '$12.34',
    '1.234',
    '12.34junk',
    '1,00.00',
    '--1',
    '-+1',
    '(12.34)',
    '12.34CR',
    '10000000000000.01',
  ])('rejects unsupported money %s', (value) =>
    expect(() => parseBankMoney(value, bankDefaults)).toThrow(),
  );
  it('validates Gregorian date components and explicit yearless date context', () => {
    expect(parseBankDate('2024-02-29', bankDefaults)).toBe('2024-02-29');
    expect(parseBankDate('0001-01-01', bankDefaults)).toBe('0001-01-01');
    expect(parseBankDate('29/02', { datePattern: 'DD/MM', statementYear: 2024 })).toBe(
      '2024-02-29',
    );
    for (const value of ['2023-02-29', '2024-04-31', '0000-01-01', '24-02-29'])
      expect(() => parseBankDate(value, bankDefaults)).toThrow();
    expect(() => parseBankDate('01/02', { datePattern: 'DD/MM', statementYear: null })).toThrow();
  });
});
describe('review, provenance and whole-chain reconciliation', () => {
  it('reconciles all three actual movements and exports both balance roles and an attached source line', () => {
    const doc = knownBankDocument();
    const p = params();
    const review = reviewBankStatement(doc, p, { requireComplete: true });
    expect(review.status).toBe('reconciled');
    expect(review.delta).toBe('0.00');
    expect(review.acceptedSum).toBe('-87.34');
    expect(review.rows[1]!.description).toBe('Card purchase continued note');
    const rows = reopened(exportBankStatement(doc, p));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      status: 'accepted',
      role: 'opening',
      amount: '',
      balance: '1000.00',
      sourcePage: '1',
      sourceLine: '1',
    });
    expect(rows[2]).toMatchObject({
      status: 'attached',
      originalText: 'continued note',
      sourcePage: '1',
      sourceLine: '3',
    });
    const sum = rows
      .filter((r) => r.status === 'accepted' && r.role === 'transaction')
      .reduce((a, r) => a + BigInt(r.amount!.replace('.', '')), 0n);
    expect(sum).toBe(-8734n);
    expect(
      rows.every((r) => r.overallStatus === 'reconciled' && r.reconciliationDelta === '0.00'),
    ).toBe(true);
    expect(JSON.stringify(review)).not.toContain('BigInt');
  });
  it('retains ignored money and the printed closing rather than silently zeroing the reduced sum', () => {
    const p = params();
    p.lineDecisions.find((d) => d.id === 'p2-l1')!.decision = 'ignore';
    p.lineDecisions.find((d) => d.id === 'p2-l1')!.reason =
      'Excluded movement after reviewing original';
    const review = reviewBankStatement(knownBankDocument(), p);
    expect(review.delta).toBe('100.00');
    expect(review.status).toBe('reviewed-with-exceptions');
    expect(
      reopened(exportBankStatement(knownBankDocument(), p)).find(
        (r) => r.sourcePage === '2' && r.sourceLine === '1',
      ),
    ).toMatchObject({
      status: 'ignored',
      amount: '-100.00',
      balance: '912.66',
      overallStatus: 'reviewed-with-exceptions',
    });
  });
  it.each([
    'missing-anchors',
    'offset-chain',
    'partial-chain',
    'wrong-first-balance',
    'wrong-last-balance',
  ] as const)('does not reconcile %s', (kind) => {
    const doc: BankDocument = {
      rowTolerance: 2,
      pages: [{ page: 1, width: 600, height: 800, visual: 'text' }],
      lines: [
        line(1, 1, 700, [
          [35, '2026-01-01'],
          [120, 'A'],
          [360, '-10.00'],
          [440, '990.00'],
        ]),
        line(1, 2, 650, [
          [35, '2026-01-02'],
          [120, 'B'],
          [360, '-20.00'],
          [440, '970.00'],
        ]),
      ],
    };
    const p: BankParams = {
      ...structuredClone(bankDefaults),
      opening: '1000.00',
      closing: '970.00',
      acknowledged: true,
      lineDecisions: doc.lines.map((l) => ({ id: l.id, decision: 'accept', role: 'transaction' })),
    };
    if (kind === 'missing-anchors') p.opening = null;
    if (kind === 'offset-chain') {
      doc.lines[0] = line(1, 1, 700, [
        [35, '2026-01-01'],
        [120, 'A'],
        [360, '-10.00'],
        [440, '0.00'],
      ]);
      doc.lines[1] = line(1, 2, 650, [
        [35, '2026-01-02'],
        [120, 'B'],
        [360, '-20.00'],
        [440, '-20.00'],
      ]);
    }
    if (kind === 'partial-chain')
      doc.lines[1] = line(1, 2, 650, [
        [35, '2026-01-02'],
        [120, 'B'],
        [360, '-20.00'],
      ]);
    if (kind === 'wrong-first-balance')
      doc.lines[0] = line(1, 1, 700, [
        [35, '2026-01-01'],
        [120, 'A'],
        [360, '-10.00'],
        [440, '1000.00'],
      ]);
    if (kind === 'wrong-last-balance')
      doc.lines[1] = line(1, 2, 650, [
        [35, '2026-01-02'],
        [120, 'B'],
        [360, '-20.00'],
        [440, '980.00'],
      ]);
    expect(reviewBankStatement(doc, p).status).toBe('reviewed-unreconciled');
  });
  it('allows params-only anchors without any running balances, and legitimate blank pages', () => {
    const doc = knownBankDocument();
    doc.lines = doc.lines
      .filter((l) => !['p1-l1', 'p2-l2'].includes(l.id))
      .map((l) =>
        l.id === 'p1-l3'
          ? l
          : {
              ...l,
              items: l.items.filter((i) => i.x < 430),
              text: l.items
                .filter((i) => i.x < 430)
                .map((i) => i.text)
                .join(' '),
            },
      );
    doc.lines[0]!.id = 'p1-l1';
    doc.lines[0]!.line = 1;
    doc.lines[1]!.id = 'p1-l2';
    doc.lines[1]!.line = 2;
    doc.lines[2]!.id = 'p1-l3';
    doc.lines[2]!.line = 3;
    const p = {
      ...params(doc),
      lineDecisions: doc.lines.map((l): BankLineDecision => ({
        id: l.id,
        decision: l.id === 'p1-l2' ? 'attach' : 'accept',
        role: l.id === 'p1-l2' ? 'non-financial' : 'transaction',
        ...(l.id === 'p1-l2' ? { attachTo: 'p1-l1' } : {}),
      })),
    };
    doc.pages.push({ page: 3, width: 600, height: 800, visual: 'blank' });
    expect(reviewBankStatement(doc, p).status).toBe('reconciled');
  });
  it('requires decisions and reasons for visual pages and serializes zero-line page exceptions', () => {
    const doc = knownBankDocument();
    doc.pages.push({ page: 3, width: 600, height: 800, visual: 'nontext' });
    const p = params();
    expect(reviewBankStatement(doc, p).status).toBe('pending-review');
    expect(() => exportBankStatement(doc, p)).toThrow('decision');
    p.pageDecisions = [
      {
        page: 3,
        decision: 'ignore',
        reason: 'Scanned page inspected in original PDF; cannot extract its content',
      },
    ];
    const rows = reopened(exportBankStatement(doc, p));
    expect(rows.at(-1)).toMatchObject({
      status: 'page-ignored',
      role: 'non-financial',
      sourcePage: '3',
      sourceLine: '',
      amount: '',
      originalText: '',
      pageVisual: 'nontext',
      pageDecision: 'ignore',
      overallStatus: 'reviewed-with-exceptions',
    });
    p.pageDecisions[0]!.reason = '';
    expect(() => exportBankStatement(doc, p)).toThrow('meaningful');
  });
  it('rejects forged/duplicate/missing decisions, balance role mismatches and disguised money', () => {
    const doc = knownBankDocument();
    const p = params();
    expect(() =>
      exportBankStatement(doc, { ...p, lineDecisions: p.lineDecisions.slice(1) }),
    ).toThrow();
    expect(() =>
      exportBankStatement(doc, { ...p, lineDecisions: [...p.lineDecisions, p.lineDecisions[0]!] }),
    ).toThrow('duplicate');
    expect(() =>
      exportBankStatement(doc, {
        ...p,
        lineDecisions: [
          ...p.lineDecisions,
          { id: 'p99-l1', decision: 'ignore', role: 'non-financial' },
        ],
      }),
    ).toThrow('Unknown');
    expect(() => exportBankStatement(doc, { ...p, closing: '900.00' })).toThrow('anchor');
    const wrong = params();
    wrong.lineDecisions.find((d) => d.id === 'p1-l2')!.role = 'non-financial';
    expect(() => exportBankStatement(doc, wrong)).toThrow('monetary');
    const attach = params();
    attach.lineDecisions.find((d) => d.id === 'p2-l1')!.decision = 'attach';
    attach.lineDecisions.find((d) => d.id === 'p2-l1')!.attachTo = 'p1-l2';
    expect(() => exportBankStatement(doc, attach)).toThrow('description-only');
    expect(() => exportBankStatement(doc, { ...p, acknowledged: false })).toThrow(
      'acknowledgement',
    );
    expect(() =>
      validateBankDocument({
        ...doc,
        lines: [{ ...doc.lines[0]!, id: 'forged' }, ...doc.lines.slice(1)],
      }),
    ).toThrow('provenance');
    expect(() => validateBankParams({ ...p, unknown: true })).toThrow('unexpected');
  });
  it('calculates debit and credit once from unsigned magnitudes and rejects signed inputs or both nonzero', () => {
    const doc: BankDocument = {
      rowTolerance: 2,
      pages: [{ page: 1, width: 600, height: 800, visual: 'text' }],
      lines: [
        line(1, 1, 700, [
          [35, '2026-01-01'],
          [120, 'A'],
          [360, '10.00'],
          [440, '90.00'],
        ]),
      ],
    };
    const p: BankParams = {
      ...structuredClone(bankDefaults),
      mapping: {
        mode: 'debit-credit',
        date: [35, 115],
        description: [115, 350],
        debit: [350, 390],
        credit: [390, 430],
        balance: [430, 510],
      },
      opening: '100.00',
      closing: '90.00',
      acknowledged: true,
      lineDecisions: [{ id: 'p1-l1', decision: 'accept', role: 'transaction' }],
    };
    expect(reviewBankStatement(doc, p).rows[0]).toMatchObject({
      debit: '10.00',
      credit: '',
      amount: '-10.00',
    });
    expect(reviewBankStatement(doc, p).status).toBe('reconciled');
    expect(() =>
      reviewBankStatement(doc, {
        ...p,
        lineDecisions: [{ ...p.lineDecisions[0]!, edited: { amount: '-10.00' } }],
      }),
    ).toThrow('calculated net');
    doc.lines[0] = line(1, 1, 700, [
      [35, '2026-01-01'],
      [120, 'A'],
      [360, '-10.00'],
      [440, '90.00'],
    ]);
    expect(() => reviewBankStatement(doc, p)).toThrow('money');
    doc.lines[0] = line(1, 1, 700, [
      [35, '2026-01-01'],
      [120, 'A'],
      [360, '10.00'],
      [400, '2.00'],
      [440, '90.00'],
    ]);
    expect(() => reviewBankStatement(doc, p)).toThrow('Both debit');
  });
  it('uses the shared spreadsheet-safe serializer explicitly and preserves raw signed amounts', () => {
    const p = params();
    p.lineDecisions[1]!.edited = { description: '=HYPERLINK("https://example.invalid")' };
    expect(reopened(exportBankStatement(knownBankDocument(), p))[1]!.amount).toBe('-12.34');
    expect(
      reopened(exportBankStatement(knownBankDocument(), { ...p, spreadsheetSafe: true }))[1],
    ).toMatchObject({
      amount: "'-12.34",
      description: '\'=HYPERLINK("https://example.invalid") continued note',
    });
  });
  it('accepts the exact page, line and item budgets and rejects each next entry', () => {
    const doc: BankDocument = {
      rowTolerance: 2,
      pages: Array.from({ length: 100 }, (_, i) => ({
        page: i + 1,
        width: 600,
        height: 800,
        visual: 'text',
      })),
      lines: Array.from({ length: 20000 }, (_, i) =>
        line(1, i + 1, 700, [
          [35, 'a'],
          [120, 'b'],
          [200, 'c'],
          [360, 'd'],
          [440, 'e'],
        ]),
      ),
    };
    expect(validateBankDocument(doc).lines).toHaveLength(20000);
    expect(() =>
      validateBankDocument({
        ...doc,
        pages: [...doc.pages, { page: 101, width: 600, height: 800, visual: 'blank' }],
      }),
    ).toThrow('PDF pages');
    expect(() =>
      validateBankDocument({ ...doc, lines: [...doc.lines, line(1, 20001, 700, [[35, 'a']])] }),
    ).toThrow('PDF lines');
    const first = line(1, 1, 700, [
      [0, 'x'],
      [35, 'a'],
      [120, 'b'],
      [200, 'c'],
      [360, 'd'],
      [440, 'e'],
    ]);
    expect(() => validateBankDocument({ ...doc, lines: [first, ...doc.lines.slice(1)] })).toThrow(
      'text budget',
    );
  });
  it('rejects a long joined line and the aggregate UTF-8 text budget without returning a partial document', () => {
    const base = { rowTolerance: 2, pages: [{ page: 1, width: 600, height: 800, visual: 'text' }] };
    expect(() =>
      validateBankDocument({ ...base, lines: [line(1, 1, 700, [[35, 'x'.repeat(4097)]])] }),
    ).toThrow('Line text');
    const lines = Array.from({ length: 3000 }, (_, i) => {
      const row = line(1, i + 1, 700, [[35, 'x'.repeat(4096)]]);
      row.items[0]!.width = 100;
      return row;
    });
    expect(() => validateBankDocument({ ...base, lines })).toThrow('text budget');
  });
  it('fails explicitly when retained CSV provenance exceeds the shared cell-text budget despite a valid source', () => {
    const doc: BankDocument = {
      rowTolerance: 2,
      pages: Array.from({ length: 100 }, (_, i) => ({
        page: i + 1,
        width: 600,
        height: 800,
        visual: 'text',
      })),
      lines: Array.from({ length: 2000 }, (_, i) => {
        const row = line(Math.floor(i / 20) + 1, (i % 20) + 1, 700 - (i % 20) * 20, [
          [35, '2026-01-01'],
          [120, 'x'.repeat(3000)],
          [360, '0.00'],
        ]);
        row.items[1]!.width = 100;
        return row;
      }),
    };
    const p: BankParams = {
      ...structuredClone(bankDefaults),
      opening: '0.00',
      closing: '0.00',
      acknowledged: true,
      lineDecisions: doc.lines.map((row) => ({
        id: row.id,
        decision: 'accept',
        role: 'transaction',
      })),
    };
    expect(reviewBankStatement(doc, p).status).toBe('reconciled');
    expect(() => exportBankStatement(doc, p)).toThrow('CSV retained text limit is 10 MiB.');
  });
});
