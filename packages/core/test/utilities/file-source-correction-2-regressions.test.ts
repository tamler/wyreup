import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { exportCsv, parseCsv } from '../../src/utilities/csv-data.js';
import {
  bankDefaults,
  exportBankStatement,
  extractBankStatement,
  reviewBankStatement,
  type BankDocument,
  type BankParams,
} from '../../src/utilities/bank-statement.js';
import { createBankPdfEnvironment } from '../../src/utilities/bank-pdf.js';

vi.mock(
  '../../src/utilities/bank-pdf-platform.js',
  async () => import('../../src/utilities/bank-pdf-node.js'),
);

const encoder = new TextEncoder();
const auto = (source: string, hasHeader = false) =>
  parseCsv(encoder.encode(source), { delimiter: 'auto', hasHeader });

function reviewParams(document: BankDocument): BankParams {
  return {
    ...structuredClone(bankDefaults),
    opening: '1000.00',
    closing: '912.66',
    acknowledged: true,
    lineDecisions: document.lines.map((line) => ({
      id: line.id,
      decision: line.text.includes('continued') ? 'attach' : 'accept',
      role: line.text.includes('Opening')
        ? 'opening'
        : line.text.includes('Closing')
          ? 'closing'
          : line.text.includes('continued')
            ? 'non-financial'
            : 'transaction',
      ...(line.text.includes('continued') ? { attachTo: 'p1-l2' } : {}),
    })),
    pageDecisions: document.pages
      .filter((page) => ['mixed', 'nontext', 'unknown'].includes(page.visual))
      .map((page) => ({
        page: page.page,
        decision: 'include',
        reason: 'Reviewed the original visual page and all positioned text candidates.',
      })),
  };
}

async function actualPdf(kind: 'mixed' | 'scan' | 'unknown'): Promise<BankDocument> {
  const input = new Uint8Array(
    await readFile(new URL(`../fixtures/catalog-files/bank-${kind}.pdf`, import.meta.url)),
  );
  const environment = await createBankPdfEnvironment();
  return extractBankStatement(input, 2, new AbortController().signal, environment);
}

function reopenedBank(document: BankDocument, params: BankParams): Record<string, string>[] {
  const table = parseCsv(encoder.encode(exportBankStatement(document, params)), {
    delimiter: 'comma',
    hasHeader: true,
  });
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((column, index) => [column.label, row.cells[index]!])),
  );
}

describe('file source correction2 bounded CSV sample regressions', () => {
  it('detects the actual delimiter when the sample ends inside a short final record', () => {
    const source = 'ab,c\n'.repeat(20000);
    expect(encoder.encode(source).length).toBe(100000);
    expect(source.slice(65535, 65536)).toBe('a');
    const table = auto(source);
    expect(table.delimiter).toBe(',');
    expect(table.rows).toHaveLength(20000);
    expect(table.rows.every((row) => row.originalWidth === 2)).toBe(true);
    expect(table.rows[0]!.cells).toEqual(['ab', 'c']);
    expect(table.rows.at(-1)!.cells).toEqual(['ab', 'c']);
    expect(table.rows.at(-1)!.sourceRow).toBe(20000);
    expect(exportCsv(table)).toBe('ab,c\r\n'.repeat(20000));
  });

  it('detects from complete records before a quoted multiline record crosses the sample boundary', () => {
    const value = `${'x'.repeat(2048)}\nembedded,comma`;
    const source = `a,b\n${'ab,c\n'.repeat(13000)}"${value}",d\n1,2\n`;
    expect(encoder.encode(source).length).toBeGreaterThan(65536);
    const table = auto(source, true);
    expect(table.delimiter).toBe(',');
    expect(table.columns.map((column) => column.label)).toEqual(['a', 'b']);
    expect(table.rows).toHaveLength(13002);
    expect(table.rows.at(-2)!.cells).toEqual([value, 'd']);
    expect(table.rows.at(-1)!.cells).toEqual(['1', '2']);
    const reopened = parseCsv(encoder.encode(exportCsv(table)), {
      delimiter: 'comma',
      hasHeader: true,
    });
    expect(reopened.rows.map((row) => row.cells)).toEqual(table.rows.map((row) => row.cells));
  });

  it('still requires an explicit delimiter when the first actual quoted record exceeds the sample', () => {
    const value = `first\n${'漢'.repeat(22000)}`;
    const source = `"${value}",b\n1,2\n`;
    expect(encoder.encode(source).length).toBeGreaterThan(65536);
    expect(() => auto(source)).toThrow(/explicit CSV delimiter/);
    const table = parseCsv(encoder.encode(source), { delimiter: 'comma', hasHeader: false });
    expect(table.rows.map((row) => row.cells)).toEqual([
      [value, 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves CRLF records when the byte boundary falls between CR and LF', () => {
    const source = `a,b\r\n${'ab,c\r\n'.repeat(20000)}`;
    const bytes = encoder.encode(source);
    expect([...bytes.slice(65535, 65537)]).toEqual([13, 10]);
    const table = auto(source, true);
    expect(table.rows).toHaveLength(20000);
    expect(table.rows.every((row) => row.cells[0] === 'ab' && row.cells[1] === 'c')).toBe(true);
    expect(exportCsv(table)).toBe(source);
  });

  it('preserves a quoted Unicode tail when a naive 64 KiB byte slice would split a code point', () => {
    const value = `x${'漢'.repeat(1024)}`;
    const source = `a,b\n${'ab,c\n'.repeat(13000)}"${value}",d\n1,2\n`;
    const bytes = encoder.encode(source);
    expect(bytes[65535]! & 0xc0).toBe(0x80);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 65536))).toThrow();
    const table = auto(source, true);
    expect(table.rows).toHaveLength(13002);
    expect(table.rows.at(-2)!.cells).toEqual([value, 'd']);
    expect(table.rows.at(-1)!.cells).toEqual(['1', '2']);
    const reopened = parseCsv(encoder.encode(exportCsv(table)), {
      delimiter: 'comma',
      hasHeader: true,
    });
    expect(reopened.rows.map((row) => row.cells)).toEqual(table.rows.map((row) => row.cells));
  });

  it('does not hide a malformed early quote when disregarding a sampled final record', () => {
    const source = `a,b\n"bad"X,c\n${'ab,c\n'.repeat(20000)}`;
    expect(encoder.encode(source).length).toBeGreaterThan(65536);
    expect(() => auto(source, true)).toThrow(/CSV delimiter|CSV parse\/quote error/);
    expect(() => parseCsv(encoder.encode(source), { delimiter: 'comma', hasHeader: true })).toThrow(
      /CSV parse\/quote error/,
    );
  });
});

describe('file source correction2 actual visual-page reconciliation', () => {
  it('allows a reviewed included mixed page to reconcile its complete financial chain', async () => {
    const document = await actualPdf('mixed');
    expect(document.pages.some((page) => page.visual === 'mixed')).toBe(true);
    const params = reviewParams(document);
    const review = reviewBankStatement(document, params);
    expect.soft(review.delta).toBe('0.00');
    expect.soft(review.acceptedSum).toBe('-87.34');
    expect.soft(review.pending).toBe(0);
    expect
      .soft(review.rows.filter((row) => row.role === 'transaction').map((row) => row.balance))
      .toEqual(['987.66', '1012.66', '912.66']);
    expect.soft(review.status).toBe('reconciled');
    const rows = reopenedBank(document, params);
    expect(rows.every((row) => row.overallStatus === 'reconciled')).toBe(true);
    expect(rows.some((row) => row.pageVisual === 'mixed' && row.pageDecision === 'include')).toBe(
      true,
    );
  }, 30000);

  it.each(['scan', 'unknown'] as const)(
    'retains included %s pages as explicit exceptions even with zero financial delta',
    async (kind) => {
      const document = await actualPdf(kind);
      const visual = kind === 'scan' ? 'nontext' : 'unknown';
      expect(document.pages.some((page) => page.visual === visual)).toBe(true);
      const params = reviewParams(document);
      expect(reviewBankStatement(document, params)).toMatchObject({
        status: 'reviewed-with-exceptions',
        delta: '0.00',
        pending: 0,
      });
      expect(
        reopenedBank(document, params).some(
          (row) =>
            row.status === 'page-included' &&
            row.pageVisual === visual &&
            row.overallStatus === 'reviewed-with-exceptions',
        ),
      ).toBe(true);
    },
    30000,
  );

  it('keeps ignored mixed-page money as exceptions and retains its page provenance', async () => {
    const document = await actualPdf('mixed');
    const params = reviewParams(document);
    const page = document.pages.find((candidate) => candidate.visual === 'mixed')!;
    params.pageDecisions.find((decision) => decision.page === page.page)!.decision = 'ignore';
    for (const line of document.lines.filter((candidate) => candidate.page === page.page)) {
      const decision = params.lineDecisions.find((candidate) => candidate.id === line.id)!;
      decision.decision = 'ignore';
      decision.reason = 'Explicitly excluded original mixed visual page.';
    }
    expect(reviewBankStatement(document, params).status).toBe('reviewed-with-exceptions');
    expect(
      reopenedBank(document, params).some(
        (row) =>
          row.pageVisual === 'mixed' &&
          row.pageDecision === 'ignore' &&
          row.overallStatus === 'reviewed-with-exceptions',
      ),
    ).toBe(true);
  }, 30000);
});
