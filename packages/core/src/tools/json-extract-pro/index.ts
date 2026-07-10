import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface JsonExtractProParams {
  /** Free-form hint describing the fields you want extracted. */
  schema?: string;
}

export const defaultJsonExtractProParams: JsonExtractProParams = { schema: '' };

export const jsonExtractPro: ToolModule<JsonExtractProParams> = {
  id: 'json-extract-pro',
  slug: 'json-extract-pro',
  name: 'Extract JSON',
  description:
    'Hosted Llama-4 Scout pulls structured JSON out of any text — receipts, emails, contracts, log lines. Describe the fields you want and get back a valid object. Major chain unlock: feeds anything downstream that needs structured input. Uses 1 credit per run.',
  category: 'text',
  keywords: ['json', 'extract', 'structured', 'parse', 'scout', 'pro', 'llm'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 256 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',

  chainSuggestions: ['json-formatter', 'csv-json', 'json-schema-validate'],

  defaults: defaultJsonExtractProParams,
  paramSchema: {
    schema: {
      type: 'string',
      label: 'fields hint',
      placeholder: 'sender, subject, total_amount, due_date',
      help: 'List the fields you want extracted, or describe the shape in plain English.',
      multiline: true,
    },
  },

  async run(inputs: File[], params: JsonExtractProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('json-extract-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    const schema = (params.schema ?? '').trim();

    const result = await runPro<{ data: unknown }>(
      'json-extract-pro',
      { text, schema, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
