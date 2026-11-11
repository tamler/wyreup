import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type ExplainCodeLevel = 'beginner' | 'expert';

export interface ExplainCodeProParams {
  /** Programming language, if known. Empty means the model works it out. */
  language?: string;
  level?: ExplainCodeLevel;
}

export const defaultExplainCodeProParams: ExplainCodeProParams = {
  language: '',
  level: 'beginner',
};

/** Mirrors EXPLAIN_CODE.maxLanguageChars in functions/_lib/runners.ts. */
export const EXPLAIN_CODE_PRO_MAX_LANGUAGE_CHARS = 40;

// The snippet cap lives in PRO_TEXT_LIMITS (lib/pro-limits.ts) as 4,000
// estimated tokens, enforced by runPro() here and again on the server.

export const explainCodePro: ToolModule<ExplainCodeProParams> = {
  id: 'explain-code-pro',
  slug: 'explain-code-pro',
  name: 'Explain Code',
  description:
    'Paste a code snippet and a hosted Qwen2.5 Coder 32B model walks through what it does in plain English: the overall purpose, then the important steps, inputs, outputs and anything that looks risky. Pick beginner or expert depth. Takes up to about 12,000 characters of code per run (4,000 if it is mostly Chinese, Japanese or Korean text). The code is sent to Wyreup. Uses 1 credit per run.',
  category: 'dev',
  keywords: ['explain', 'code', 'walkthrough', 'understand', 'read', 'review', 'plain english', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 256 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['word-counter', 'text-translate-pro'],

  defaults: defaultExplainCodeProParams,
  paramSchema: {
    language: {
      type: 'string',
      label: 'language',
      placeholder: 'auto-detect',
      help: 'Optional, such as Python, TypeScript or Bash. Leave blank to let the model work it out.',
      maxLength: EXPLAIN_CODE_PRO_MAX_LANGUAGE_CHARS,
    },
    level: {
      type: 'enum',
      label: 'level',
      help: 'Beginner explains terms and avoids jargon. Expert skips the basics and focuses on design, edge cases and risks.',
      options: [
        { value: 'beginner', label: 'beginner' },
        { value: 'expert', label: 'expert' },
      ],
    },
  },

  async run(inputs: File[], params: ExplainCodeProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('explain-code-pro accepts exactly one input.');
    const code = await inputs[0]!.text();
    if (!code.trim()) throw new Error('Empty input.');
    const language = (params.language ?? '').trim();
    if (language.length > EXPLAIN_CODE_PRO_MAX_LANGUAGE_CHARS) {
      throw new Error(
        `The language name is limited to ${EXPLAIN_CODE_PRO_MAX_LANGUAGE_CHARS} characters.`,
      );
    }
    const level = params.level ?? 'beginner';
    if (level !== 'beginner' && level !== 'expert') throw new Error('Unsupported level.');

    const result = await runPro<{ explanation: string }>(
      'explain-code-pro',
      { text: code, level, ...(language ? { language } : {}), fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.explanation], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
