// Worst-case Cloudflare cost per Pro run, checked against the margin floor.
//
// Rule (approved 2026-11-11): one run's worst-case provider cost must be at
// most 50% of the worst-case net revenue for the credits it charges.
// Worst-case revenue per credit is the $8 / 440-credit monthly plan after a
// 5% + $0.50 payment fee: (8 x 0.95 - 0.50) / 440 = $0.016136.
//
// "Worst case" means the largest input the server accepts, the full output
// token budget, and every call the runner can make (including a fallback
// call after a failed, possibly still billed, primary call).
//
// Text inputs are bounded in estimated tokens by PRO_TEXT_LIMITS
// (packages/core/src/lib/pro-limits.ts), where every non-ASCII character
// counts as a full token. So an all-CJK or emoji input at the cap is
// already the worst case here. Short char-capped fields (target language,
// tone) are counted at 1 token per character.
//
// cost-model.test.ts asserts every entry clears the floor and that every
// priced tool is either modelled here or listed in UNBOUNDED_TOOLS with a
// reason, so a new tool or a raised cap cannot slip past the rule.

import { PRICING } from './pricing';
import {
  DEEP_ANALYSIS,
  FIX_GRAMMAR,
  MODEL_GLM_FLASH,
  MODEL_GUARD,
  MODEL_SCOUT,
  SENTIMENT_MAX_TOKENS,
} from './runners';
import { MAX_TOKENS } from './timeout';
import { TEXT_MODEL } from './providers/text-models';
import { VISION_MODEL } from './providers/vision-models';
import { MAX_STEPS } from './providers/image-gen-models';
import { TTS_LANGS, TTS_MAX_CHARS, TTS_USD_PER_1K_CHARS } from './providers/tts-models';
import { PRO_TEXT_LIMITS } from '../../packages/core/src/lib/pro-limits';

export const WORST_NET_USD_PER_CREDIT = (8 * 0.95 - 0.5) / 440;
export const MAX_COST_SHARE = 0.5;
/**
 * Tokens per call for system prompt, wrapper text and chat template. The
 * longest system prompt in runners.ts is under 600 characters (about 200
 * tokens), so 300 covers every call.
 */
export const PROMPT_OVERHEAD_TOKENS = 300;
/**
 * Llama 3.2 Vision splits an image into at most 4 tiles of 560x560, each
 * 1,601 tokens. Assumption from the model architecture; Cloudflare does
 * not publish an image token count.
 */
export const VISION_IMAGE_TOKENS = 4 * 1_601;
/** flux-1-schnell on Workers AI returns 1024x1024: four 512x512 tiles. */
export const FLUX_OUTPUT_TILES = 4;

/** Cloudflare Workers AI list prices, USD per million tokens (pricing page, 2026-10-20). */
export const TOKEN_PRICES: Readonly<Record<string, { inPerM: number; outPerM: number }>> = {
  [TEXT_MODEL]: { inPerM: 0.293, outPerM: 2.253 },
  [MODEL_SCOUT]: { inPerM: 0.27, outPerM: 0.85 },
  [MODEL_GUARD]: { inPerM: 0.484, outPerM: 0.03 },
  [MODEL_GLM_FLASH]: { inPerM: 0.06, outPerM: 0.4 },
  [VISION_MODEL]: { inPerM: 0.049, outPerM: 0.676 },
  [DEEP_ANALYSIS.primaryModel]: { inPerM: 0.3, outPerM: 1.2 },
  [DEEP_ANALYSIS.fallbackModel]: { inPerM: 0.1, outPerM: 0.3 },
};
const FLUX_USD_PER_TILE = 0.0000528;
const FLUX_USD_PER_STEP = 0.0001056;

/** Short char-capped fields read with readOptionalText in runners.ts. */
const TARGET_CHARS = 100;
const TONE_CHARS = 32;

export interface LlmCall {
  model: string;
  /** Estimated input tokens excluding PROMPT_OVERHEAD_TOKENS. */
  inputTokens: number;
  maxOutputTokens: number;
}

export function llmCallUsd(call: LlmCall): number {
  const price = TOKEN_PRICES[call.model];
  if (!price) throw new Error(`No price for ${call.model}`);
  return (
    ((call.inputTokens + PROMPT_OVERHEAD_TOKENS) * price.inPerM +
      call.maxOutputTokens * price.outPerM) /
    1e6
  );
}

/** Sum of the token caps for a tool's limited fields. */
export function limitTokens(toolId: string): number {
  const limits = PRO_TEXT_LIMITS[toolId];
  if (!limits) throw new Error(`No text limits for ${toolId}`);
  return Object.values(limits).reduce((a, b) => a + b, 0);
}

export interface WorstCase {
  toolId: string;
  /** Human-readable description of the worst case. */
  detail: string;
  usd: number;
}

function llmCase(toolId: string, calls: LlmCall[]): WorstCase {
  return {
    toolId,
    detail: calls
      .map(
        (c) => `${c.model}: ${c.inputTokens + PROMPT_OVERHEAD_TOKENS} in, ${c.maxOutputTokens} out`,
      )
      .join(' + '),
    usd: calls.reduce((sum, c) => sum + llmCallUsd(c), 0),
  };
}

const chatCall = (
  toolId: string,
  extraTokens = 0,
  maxOutputTokens: number = MAX_TOKENS.default,
) => ({
  model: TEXT_MODEL,
  inputTokens: limitTokens(toolId) + extraTokens,
  maxOutputTokens,
});

const visionCall = (extraTokens = 0): LlmCall => ({
  model: VISION_MODEL,
  inputTokens: VISION_IMAGE_TOKENS + extraTokens,
  maxOutputTokens: MAX_TOKENS.vision,
});

export const WORST_CASES: readonly WorstCase[] = [
  {
    toolId: 'text-to-speech-pro',
    detail: TTS_LANGS.map(
      (l) => `${l}: ${TTS_MAX_CHARS[l]} chars at $${TTS_USD_PER_1K_CHARS[l]}/1k`,
    ).join('; '),
    usd: Math.max(...TTS_LANGS.map((l) => (TTS_MAX_CHARS[l] / 1000) * TTS_USD_PER_1K_CHARS[l])),
  },
  llmCase('deep-analysis-pro', [
    {
      model: DEEP_ANALYSIS.primaryModel,
      inputTokens: limitTokens('deep-analysis-pro'),
      maxOutputTokens: DEEP_ANALYSIS.maxOutputTokens,
    },
    {
      model: DEEP_ANALYSIS.fallbackModel,
      inputTokens: limitTokens('deep-analysis-pro'),
      maxOutputTokens: DEEP_ANALYSIS.maxOutputTokens,
    },
  ]),
  llmCase('fix-grammar-pro', [
    {
      model: FIX_GRAMMAR.model,
      inputTokens: limitTokens('fix-grammar-pro'),
      maxOutputTokens: FIX_GRAMMAR.maxOutputTokens,
    },
  ]),
  llmCase('text-summarize-pro', [chatCall('text-summarize-pro')]),
  llmCase('text-translate-pro', [chatCall('text-translate-pro', TARGET_CHARS)]),
  llmCase('text-sentiment-pro', [chatCall('text-sentiment-pro', 0, SENTIMENT_MAX_TOKENS)]),
  llmCase('text-ner-pro', [chatCall('text-ner-pro')]),
  llmCase('text-redact-pro', [chatCall('text-redact-pro')]),
  llmCase('regex-from-text-pro', [chatCall('regex-from-text-pro')]),
  llmCase('cron-from-text-pro', [chatCall('cron-from-text-pro')]),
  llmCase('pdf-summarize', [chatCall('pdf-summarize')]),
  llmCase('pdf-q-and-a', [chatCall('pdf-q-and-a')]),
  llmCase('content-safety-pro', [
    {
      model: MODEL_GUARD,
      inputTokens: limitTokens('content-safety-pro'),
      maxOutputTokens: MAX_TOKENS.classification,
    },
  ]),
  llmCase('rewrite-tone-pro', [
    {
      model: MODEL_GLM_FLASH,
      inputTokens: limitTokens('rewrite-tone-pro') + TONE_CHARS,
      maxOutputTokens: MAX_TOKENS.default,
    },
  ]),
  llmCase('chat-long-pdf-pro', [
    {
      model: MODEL_SCOUT,
      inputTokens: limitTokens('chat-long-pdf-pro'),
      maxOutputTokens: MAX_TOKENS.reasoning,
    },
  ]),
  llmCase('json-extract-pro', [
    {
      model: MODEL_SCOUT,
      inputTokens: limitTokens('json-extract-pro'),
      maxOutputTokens: MAX_TOKENS.default,
    },
  ]),
  llmCase('ocr-hq', [visionCall()]),
  llmCase('image-describe', [visionCall()]),
  llmCase('analyze-chart', [visionCall()]),
  llmCase('read-handwriting', [visionCall()]),
  llmCase('image-q-and-a', [visionCall(limitTokens('image-q-and-a'))]),
  // Vision extracts text (<= MAX_TOKENS.vision), then Llama 3.3 translates it.
  llmCase('translate-image', [
    visionCall(),
    {
      model: TEXT_MODEL,
      inputTokens: MAX_TOKENS.vision + TARGET_CHARS,
      maxOutputTokens: MAX_TOKENS.default,
    },
  ]),
  {
    toolId: 'image-generate-pro',
    detail: `flux-1-schnell: ${FLUX_OUTPUT_TILES} tiles, ${MAX_STEPS} steps`,
    usd: FLUX_OUTPUT_TILES * FLUX_USD_PER_TILE + MAX_STEPS * FLUX_USD_PER_STEP,
  },
];

/** Priced tools whose worst case this model cannot bound, and why. */
export const UNBOUNDED_TOOLS: Readonly<Record<string, string>> = {
  'transcribe-pro':
    'Whisper bills per audio minute and the runner only caps bytes (25 MB); a low-bitrate file can hold hours. Needs a duration check.',
  'transcribe-and-translate':
    'Same Whisper per-minute exposure as transcribe-pro, plus a Llama 3.3 call.',
  'translate-many-pro':
    'm2m100 bills input and output tokens and its Workers AI schema has no output-length parameter.',
  'translate-document-pro':
    'm2m100 per chunk, up to 30 chunks, with no output-length parameter; input alone at 120,000 chars can approach the floor.',
  'translate-indic-pro':
    'IndicTrans2 bills input and output tokens with no output-length parameter.',
  'detect-objects': 'detr-resnet-50 has no list price on the Workers AI pricing page.',
  'bg-remove-pro': 'Runs on Replicate (per-second GPU billing), not Workers AI.',
  'upscale-2x-pro': 'Runs on Replicate (per-second GPU billing), not Workers AI.',
};

export function floorUsd(toolId: string): number {
  const credits = PRICING[toolId];
  if (credits === undefined) throw new Error(`No price for ${toolId}`);
  return credits * WORST_NET_USD_PER_CREDIT * MAX_COST_SHARE;
}
