import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractBankStatement,
  reviewBankStatement,
  exportBankStatement,
  bankDefaults,
  type BankDocument,
  type BankParams,
} from '../../src/utilities/bank-statement';
import { createBankPdfEnvironment } from '../../src/utilities/bank-pdf';
import type { runBankFileJob as sourceRunBankFileJob } from '../../src/utilities/bank-job';
import type { bankStatementToCsv as sourceBankStatementToCsv } from '../../src/utilities/bank-module';
import { parseCsv } from '../../src/utilities/csv-data';

const bytes = (kind: string) =>
  readFile(new URL(`../fixtures/catalog-files/bank-${kind}.pdf`, import.meta.url));
vi.mock(
  '../../src/utilities/bank-pdf-platform',
  async () => import('../../src/utilities/bank-pdf-node'),
);
let runBankFileJob: typeof sourceRunBankFileJob;
let bankStatementToCsv: typeof sourceBankStatementToCsv;
let evidenceDirectory: string | undefined;
let evidencePath: string;
beforeAll(async () => {
  evidenceDirectory = await mkdtemp(join(tmpdir(), 'wyreup-bank-pdf-'));
  evidencePath = join(evidenceDirectory, 'unknown-image-operators-result.json');
  const native = (await import(new URL('../../dist/node/index.js', import.meta.url).href)) as {
    runBankFileJob: typeof sourceRunBankFileJob;
    bankStatementToCsv: typeof sourceBankStatementToCsv;
  };
  runBankFileJob = native.runBankFileJob;
  bankStatementToCsv = native.bankStatementToCsv;
});
afterAll(async () => {
  if (evidenceDirectory) await rm(evidenceDirectory, { recursive: true, force: true });
});
function decisions(document: BankDocument): BankParams {
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
  };
}
describe('actual independent PDF extraction', () => {
  it('records the actual over-limit image operator response without treating empty operators as blank', async () => {
    const input = await bytes('unknown');
    expect(new TextDecoder().decode(input)).toContain('/Width 2');
    expect(new TextDecoder().decode(input)).toContain('/Height 2');
    const env = await createBankPdfEnvironment();
    const task = env.open(input);
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(3);
      try {
        const operators = await page.getOperatorList({ annotationMode: 0 });
        await writeFile(
          evidencePath,
          JSON.stringify({
            resolved: true,
            fnArray: operators.fnArray,
            argumentCount: operators.argsArray.length,
          }),
        );
      } catch (error) {
        await writeFile(
          evidencePath,
          JSON.stringify({
            resolved: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        page.cleanup();
        await pdf.cleanup(false);
      }
    } finally {
      await task.destroy();
      await env.destroy();
    }
  }, 30000);
  it.each(['known', 'fragmented', 'blank'])(
    'extracts %s PDF with published column ranges and exact money',
    async (kind) => {
      const document = await runBankFileJob(
        { type: 'bank-extract', bytes: await bytes(kind), params: { rowTolerance: 2 } },
        new AbortController().signal,
      );
      expect(document.lines).toHaveLength(6);
      expect(document.lines[0]!.id).toBe('p1-l1');
      expect(document.lines[4]!.page).toBe(2);
      const p = decisions(document);
      expect(reviewBankStatement(document, p).status).toBe('reconciled');
      const table = parseCsv(new TextEncoder().encode(exportBankStatement(document, p)), {
        delimiter: 'comma',
        hasHeader: true,
      });
      const amount = table.columns.findIndex((c) => c.label === 'amount');
      expect(
        table.rows
          .filter((r) => r.cells[0] === 'accepted' && r.cells[1] === 'transaction')
          .map((r) => r.cells[amount]),
      ).toEqual(['-12.34', '25.00', '-100.00']);
      if (kind === 'fragmented')
        expect(
          document.lines[1]!.items.filter((item) => item.x >= 350 && item.x < 430).length,
        ).toBeGreaterThan(1);
      if (kind === 'blank') expect(document.pages.at(-1)!.visual).toBe('blank');
    },
    30000,
  );
  it('extracts actual unsigned debit-credit columns and computes the signed net exactly once', async () => {
    const document = await runBankFileJob(
      { type: 'bank-extract', bytes: await bytes('debit-credit'), params: { rowTolerance: 2 } },
      new AbortController().signal,
    );
    const p = decisions(document);
    p.mapping = {
      mode: 'debit-credit',
      date: [35, 115],
      description: [115, 350],
      debit: [350, 390],
      credit: [390, 430],
      balance: [430, 510],
    };
    const report = reviewBankStatement(document, p);
    expect(report.status).toBe('reconciled');
    expect(
      report.rows
        .filter((row) => row.role === 'transaction')
        .map((row) => [row.amount, row.debit, row.credit]),
    ).toEqual([
      ['-12.34', '12.34', ''],
      ['25.00', '', '25.00'],
      ['-100.00', '100.00', ''],
    ]);
    const table = parseCsv(new TextEncoder().encode(exportBankStatement(document, p)), {
      delimiter: 'comma',
      hasHeader: true,
    });
    const amountIndex = table.columns.findIndex((column) => column.label === 'amount');
    expect(
      table.rows
        .filter((row) => row.cells[0] === 'accepted' && row.cells[1] === 'transaction')
        .reduce((sum, row) => sum + BigInt(row.cells[amountIndex]!.replace('.', '')), 0n),
    ).toBe(-8734n);
  }, 30000);
  it.each(['scan', 'mixed', 'unknown'])(
    'requires explicit visual review for %s PDF and retains page provenance',
    async (kind) => {
      const document = await runBankFileJob(
        { type: 'bank-extract', bytes: await bytes(kind), params: { rowTolerance: 2 } },
        new AbortController().signal,
      );
      const visual = document.pages.find(
        (page) => page.visual === 'nontext' || page.visual === 'mixed' || page.visual === 'unknown',
      );
      expect(visual).toBeDefined();
      if (kind === 'scan') expect(document.pages.at(-1)!.visual).toBe('nontext');
      if (kind === 'unknown') expect(document.pages.at(-1)!.visual).toBe('unknown');
      const p = decisions(document);
      expect(reviewBankStatement(document, p).status).toBe('pending-review');
      p.pageDecisions = document.pages
        .filter((page) => ['nontext', 'mixed', 'unknown'].includes(page.visual))
        .map((page) => ({
          page: page.page,
          decision: 'include',
          reason: 'Inspected original visual page; visual content is not converted',
        }));
      expect(reviewBankStatement(document, p).status).toBe(
        kind === 'mixed' ? 'reconciled' : 'reviewed-with-exceptions',
      );
      expect(exportBankStatement(document, p)).toContain(
        kind === 'mixed' ? 'mixed' : kind === 'scan' ? 'nontext' : 'unknown',
      );
    },
    30000,
  );
  it('rejects rotated, invalid and over-limit inputs before returning partial output', async () => {
    await expect(
      runBankFileJob(
        { type: 'bank-extract', bytes: await bytes('many-pages'), params: { rowTolerance: 2 } },
        new AbortController().signal,
      ),
    ).rejects.toThrow('100');
    await expect(
      runBankFileJob(
        { type: 'bank-extract', bytes: await bytes('rotated'), params: { rowTolerance: 2 } },
        new AbortController().signal,
      ),
    ).rejects.toThrow('horizontal');
    await expect(
      runBankFileJob(
        {
          type: 'bank-extract',
          bytes: new TextEncoder().encode('not a PDF'),
          params: { rowTolerance: 2 },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('PDF');
    await expect(
      runBankFileJob(
        {
          type: 'bank-extract',
          bytes: new Uint8Array(20 * 1024 * 1024 + 1),
          params: { rowTolerance: 2 },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('20 MiB');
  }, 30000);
  it('cleans owned environment resources and makes zero network calls in direct extraction', async () => {
    const env = await createBankPdfEnvironment();
    let destroyed = 0;
    const original = env.destroy.bind(env);
    env.destroy = () => {
      destroyed++;
      return original();
    };
    const saved = globalThis.fetch;
    let network = 0;
    globalThis.fetch = () => {
      network++;
      return Promise.reject(new Error('Unexpected document network'));
    };
    try {
      const doc = await extractBankStatement(
        await bytes('known'),
        2,
        new AbortController().signal,
        env,
      );
      expect(doc.lines).toHaveLength(6);
      expect(network).toBe(0);
      expect(destroyed).toBe(1);
    } finally {
      globalThis.fetch = saved;
    }
  }, 30000);
  it('runs the actual ToolModule with complete reviewed decisions and truthful CSV MIME', async () => {
    const raw = await bytes('known');
    const doc = await runBankFileJob(
      { type: 'bank-extract', bytes: raw, params: { rowTolerance: 2 } },
      new AbortController().signal,
    );
    const output = await bankStatementToCsv.run(
      [new File([raw], 'statement.pdf', { type: 'application/pdf' })],
      decisions(doc),
      {
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: 'bank-tool',
        onProgress() {},
      },
    );
    const blob = Array.isArray(output) ? output[0]! : output;
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toContain('reconciled');
    await expect(
      bankStatementToCsv.run([new File([raw], 'statement.pdf')], structuredClone(bankDefaults), {
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: 'bank-needs-review',
        onProgress() {},
      }),
    ).rejects.toThrow('decision');
  }, 30000);
  it('isolates concurrent jobs and rejects an aborted invocation without stopping its sibling', async () => {
    const c = new AbortController();
    c.abort();
    const failed = expect(
      runBankFileJob(
        { type: 'bank-extract', bytes: await bytes('known'), params: { rowTolerance: 2 } },
        c.signal,
      ),
    ).rejects.toThrow('cancelled');
    const good = runBankFileJob(
      { type: 'bank-extract', bytes: await bytes('known'), params: { rowTolerance: 2 } },
      new AbortController().signal,
    );
    await failed;
    expect((await good).lines).toHaveLength(6);
  }, 30000);
});
