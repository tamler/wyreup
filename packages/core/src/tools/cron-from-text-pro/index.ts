import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface CronFromTextProParams {
  description: string;
}

export const defaultCronFromTextProParams: CronFromTextProParams = { description: '' };

interface CronFromTextProResult {
  cron: string;
  explanation: string;
}

export const cronFromTextPro: ToolModule<CronFromTextProParams> = {
  id: 'cron-from-text-pro',
  slug: 'cron-from-text-pro',
  name: 'Cron From Text',
  description:
    'AI-generated cron expressions for schedules the free heuristic engine cannot parse. A hosted LLM handles arbitrary, open-ended phrasings. Uses 1 credit per run.',
  category: 'inspect',
  keywords: ['cron', 'crontab', 'schedule', 'natural language', 'generate', 'pro', 'ai', 'llm'],

  input: { accept: ['text/plain'], min: 0, max: 1, sizeLimit: 8 * 1024 },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  outputDisplay: 'mono',

  chainSuggestions: ['cron-parser'],

  defaults: defaultCronFromTextProParams,
  paramSchema: {
    description: {
      type: 'string',
      label: 'description',
      placeholder: 'every second Tuesday at 6:45pm, but not in December',
      help: "Plain English. The AI handles open-ended schedules the free Cron From Text can't.",
      multiline: true,
    },
  },

  async run(inputs: File[], params: CronFromTextProParams, ctx: ToolRunContext): Promise<Blob> {
    let description = params.description?.trim() ?? '';
    if (!description && inputs.length === 1) {
      description = (await inputs[0]!.text()).trim();
    }
    if (!description) throw new Error('Enter a schedule to convert.');
    const result = await runPro<CronFromTextProResult>('cron-from-text-pro', { description }, ctx);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
