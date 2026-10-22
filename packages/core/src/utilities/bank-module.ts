import type { ToolModule } from '../types.js';
import {
  BANK_LIMITS,
  bankDefaults,
  bankParamSchema,
  exportBankStatement,
  validateBankParams,
  type BankParams,
} from './bank-statement.js';
import { runBankFileJob } from './bank-job.js';

export const bankStatementToCsv: ToolModule<BankParams> = {
  id: 'bank-statement-to-csv',
  slug: 'bank-statement-to-csv',
  name: 'Bank Statement PDF to CSV',
  description:
    'Extract horizontal selectable-text PDF statements locally, map columns and explicitly review every candidate. Exact two-decimal amounts and anchored balances determine reconciliation; images and excluded money remain disclosed exceptions. No OCR or automatic bank-format detection.',
  category: 'convert',
  keywords: ['bank', 'statement', 'pdf', 'csv', 'transactions', 'reconciliation'],
  input: { accept: ['application/pdf'], min: 1, max: 1, sizeLimit: BANK_LIMITS.inputBytes },
  output: { mime: 'text/csv', multiple: false, filename: () => 'bank-statement.csv' },
  defaults: bankDefaults,
  paramSchema: bankParamSchema,
  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  surfaces: ['web', 'cli', 'mcp'],
  async run(inputs, provided, ctx) {
    if (ctx.signal.aborted) throw new DOMException('Bank conversion cancelled.', 'AbortError');
    if (
      inputs.length !== 1 ||
      !inputs[0] ||
      !inputs[0].size ||
      inputs[0].size > BANK_LIMITS.inputBytes
    )
      throw new Error('Select one nonempty PDF of at most 20 MiB.');
    const params = validateBankParams(provided);
    const bytes = new Uint8Array(await inputs[0].arrayBuffer());
    if (ctx.signal.aborted) throw new DOMException('Bank conversion cancelled.', 'AbortError');
    ctx.onProgress({
      stage: 'processing',
      percent: 10,
      message: 'Extracting selectable text in an owned local worker',
    });
    const document = await runBankFileJob(
      { type: 'bank-extract', bytes, params: { rowTolerance: params.rowTolerance } },
      ctx.signal,
    );
    if (ctx.signal.aborted) throw new DOMException('Bank conversion cancelled.', 'AbortError');
    const csv = exportBankStatement(document, params, ctx.signal);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Reviewed statement exported' });
    return [new Blob([csv], { type: 'text/csv' })];
  },
  __testFixtures: {
    valid: ['test/fixtures/catalog-files/bank-known.pdf'],
    weird: [
      'test/fixtures/catalog-files/bank-scan.pdf',
      'test/fixtures/catalog-files/bank-rotated.pdf',
    ],
    expectedOutputMime: ['text/csv'],
  },
};
