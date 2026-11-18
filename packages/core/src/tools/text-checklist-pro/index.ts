import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import { CHECKLIST_CLIENT_LIMITS, parseChecklist } from './questions.js';

export { CHECKLIST_CLIENT_LIMITS, parseChecklist } from './questions.js';
export type { ChecklistKind, ChecklistQuestion } from './questions.js';

export interface TextChecklistProParams {
  /** One question per line. See questions.ts for the [ ] option syntax. */
  questions: string;
}

export const defaultTextChecklistProParams: TextChecklistProParams = { questions: '' };

export const textChecklistPro: ToolModule<TextChecklistProParams> = {
  id: 'text-checklist-pro',
  slug: 'text-checklist-pro',
  name: 'Text Checklist',
  description:
    "Ask up to 10 yes/no, pick-one or score questions about a text, such as whether an email is urgent or which category a ticket belongs to, and get a probability for every option instead of a paragraph. Runs on Cloudflare's hosted clef-flash decision model. Text only, up to 16,000 characters. Uses 1 credit per run.",
  category: 'text',
  keywords: [
    'checklist',
    'classify',
    'classification',
    'yes no',
    'probability',
    'triage',
    'categorize',
    'clef',
    'pro',
  ],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    // 16,000 characters of UTF-8 text is at most 64 KB.
    sizeLimit: 64 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',

  chainSuggestions: ['json-formatter', 'json-flatten', 'json-to-excel'],

  defaults: defaultTextChecklistProParams,
  paramSchema: {
    questions: {
      type: 'string',
      label: 'questions',
      placeholder:
        'Is this email urgent?\nWhich team should handle it? [billing | technical | sales]\nHow severe is it? [score: none | minor | major | critical]',
      help: 'One question per line, up to 10. A plain line is yes/no. Add options in [ ] separated by | to pick one. Start the brackets with "score:" for levels from lowest to highest.',
      multiline: true,
    },
  },

  async run(inputs: File[], params: TextChecklistProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-checklist-pro accepts exactly one input.');
    const text = (await inputs[0]!.text()).trim();
    if (!text) throw new Error('Empty input.');
    if (text.length > CHECKLIST_CLIENT_LIMITS.maxTextChars)
      throw new Error(
        `Text is ${text.length} characters. The limit is ${CHECKLIST_CLIENT_LIMITS.maxTextChars}.`,
      );
    const questions = parseChecklist(params.questions ?? '');

    const result = await runPro<{ results: unknown[] }>(
      'text-checklist-pro',
      { text, questions, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
