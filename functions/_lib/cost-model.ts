// Worst-case Cloudflare cost per Pro run, checked against the margin floor.
//
// Rule (approved 2026-11-11): one run's worst-case provider cost must be at
// most 50% of the worst-case net revenue for the credits it charges.
// Worst-case revenue per credit is the $8 / 440-credit monthly plan after a
// 5% + $0.50 payment fee: (8 x 0.95 - 0.50) / 440 = $0.016136.
//
// "Worst case" means the largest input the runner accepts, the full output
// token budget, and every call the runner can make (including a fallback
// call after a failed, possibly still billed, primary call). Text is
// counted at 1 token per 3 characters. cost-model.test.ts asserts every
// entry here clears the floor and that the inputs match the live caps, so
// raising a cap or a token budget without repricing fails CI.

import { PRICING } from './pricing';
import {
  DEEP_ANALYSIS,
  FIX_GRAMMAR,
  PRO_TEXT_MAX_CHARS,
  MODEL_DEEPSEEK_FLASH,
  MODEL_GEMMA,
} from './runners';
import { TTS_LANGS, TTS_MAX_CHARS, TTS_USD_PER_1K_CHARS } from './providers/tts-models';

export const WORST_NET_USD_PER_CREDIT = (8 * 0.95 - 0.5) / 440;
export const MAX_COST_SHARE = 0.5;
export const CHARS_PER_TOKEN = 3;
/** Chat-template tokens added around system and user messages. */
export const TEMPLATE_OVERHEAD_TOKENS = 64;

/** Cloudflare Workers AI list prices, USD per million tokens (2026-10-20 pricing page). */
export const TOKEN_PRICES: Readonly<Record<string, { inPerM: number; outPerM: number }>> = {
  [MODEL_DEEPSEEK_FLASH]: { inPerM: 0.3, outPerM: 1.2 },
  [MODEL_GEMMA]: { inPerM: 0.1, outPerM: 0.3 },
};

export interface LlmCall {
  model: string;
  inputChars: number;
  maxOutputTokens: number;
}

export function tokensForChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN) + TEMPLATE_OVERHEAD_TOKENS;
}

export function llmCallUsd(call: LlmCall): number {
  const price = TOKEN_PRICES[call.model];
  if (!price) throw new Error(`No price for ${call.model}`);
  return (
    (tokensForChars(call.inputChars) * price.inPerM + call.maxOutputTokens * price.outPerM) / 1e6
  );
}

export interface WorstCase {
  toolId: string;
  /** Human-readable description of the worst case. */
  detail: string;
  usd: number;
}

const deepAnalysisInputChars =
  DEEP_ANALYSIS.system.length +
  DEEP_ANALYSIS.userTemplateChars +
  PRO_TEXT_MAX_CHARS +
  DEEP_ANALYSIS.maxQuestionChars;

const fixGrammarInputChars = FIX_GRAMMAR.system.length + FIX_GRAMMAR.maxChars;

export const WORST_CASES: readonly WorstCase[] = [
  {
    toolId: 'text-to-speech-pro',
    detail: TTS_LANGS.map(
      (l) => `${l}: ${TTS_MAX_CHARS[l]} chars at $${TTS_USD_PER_1K_CHARS[l]}/1k`,
    ).join('; '),
    usd: Math.max(...TTS_LANGS.map((l) => (TTS_MAX_CHARS[l] / 1000) * TTS_USD_PER_1K_CHARS[l])),
  },
  {
    toolId: 'deep-analysis-pro',
    detail: `${MODEL_DEEPSEEK_FLASH} then ${MODEL_GEMMA} fallback, ${deepAnalysisInputChars} input chars, ${DEEP_ANALYSIS.maxOutputTokens} output tokens each`,
    usd:
      llmCallUsd({
        model: DEEP_ANALYSIS.primaryModel,
        inputChars: deepAnalysisInputChars,
        maxOutputTokens: DEEP_ANALYSIS.maxOutputTokens,
      }) +
      llmCallUsd({
        model: DEEP_ANALYSIS.fallbackModel,
        inputChars: deepAnalysisInputChars,
        maxOutputTokens: DEEP_ANALYSIS.maxOutputTokens,
      }),
  },
  {
    toolId: 'fix-grammar-pro',
    detail: `${FIX_GRAMMAR.model}, ${fixGrammarInputChars} input chars, ${FIX_GRAMMAR.maxOutputTokens} output tokens`,
    usd: llmCallUsd({
      model: FIX_GRAMMAR.model,
      inputChars: fixGrammarInputChars,
      maxOutputTokens: FIX_GRAMMAR.maxOutputTokens,
    }),
  },
];

export function floorUsd(toolId: string): number {
  const credits = PRICING[toolId];
  if (credits === undefined) throw new Error(`No price for ${toolId}`);
  return credits * WORST_NET_USD_PER_CREDIT * MAX_COST_SHARE;
}
