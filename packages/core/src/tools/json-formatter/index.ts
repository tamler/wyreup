import type { ToolModule, ToolRunContext } from '../../types.js';
import type { JsonFormatterParams } from './types.js';

export type { JsonFormatterParams } from './types.js';
export { defaultJsonFormatterParams } from './types.js';

const JsonFormatterComponentStub = (): unknown => null;

export const jsonFormatter: ToolModule<JsonFormatterParams> = {
  id: 'json-formatter',
  slug: 'json-formatter',
  name: 'JSON Formatter',
  description: 'Parse and pretty-print JSON with configurable indentation.',
  category: 'inspect',
  presence: 'both',
  keywords: ['json', 'format', 'pretty', 'print', 'indent', 'beautify'],

  input: {
    accept: ['text/plain', 'application/json'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { indent: 2 },

  Component: JsonFormatterComponentStub,

  async run(
    inputs: File[],
    params: JsonFormatterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Parsing JSON' });

    const text = await inputs[0]!.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON: ${(err as Error).message}`);
    }

    const indent = params.indent ?? 2;
    const formatted = JSON.stringify(parsed, null, indent);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([formatted], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
