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
  EXPLAIN_CODE,
  FIX_GRAMMAR,
  MODEL_GLM_FLASH,
  MODEL_GUARD,
  MODEL_SCOUT,
  MAX_DOC_CHUNKS,
  SENTIMENT_MAX_TOKENS,
  TRANSCRIPT_TRANSLATE_MAX_TOKENS,
} from './runners';
import { MAX_TOKENS } from './timeout';
import { TEXT_MODEL } from './providers/text-models';
import { VISION_MODEL } from './providers/vision-models';
import { MAX_STEPS } from './providers/image-gen-models';
import { REPLICATE_CANCEL_AFTER_SECONDS } from './providers/image-models';
import {
  TRANSLATE_MODEL,
  TRANSLATE_OUTPUT_EXTRA_TOKENS,
  TRANSLATE_OUTPUT_FACTOR,
} from './providers/translate-models';
import { TTS_LANGS, TTS_MAX_CHARS, TTS_USD_PER_1K_CHARS } from './providers/tts-models';
import { PRO_TEXT_LIMITS } from '../../packages/core/src/lib/pro-limits';
import { HOSTED_AUDIO_MAX_SECONDS } from '../../packages/core/src/lib/audio-duration';

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
  // Gemma 4: also TRANSLATE_MODEL and FIX_GRAMMAR.model (same id).
  [DEEP_ANALYSIS.fallbackModel]: { inPerM: 0.1, outPerM: 0.3 },
  [EXPLAIN_CODE.model]: { inPerM: 0.66, outPerM: 1.0 },
};
const FLUX_USD_PER_TILE = 0.0000528;
const FLUX_USD_PER_STEP = 0.0001056;
/** @cf/openai/whisper-large-v3-turbo, per audio minute (rounded up per run here). */
export const WHISPER_USD_PER_MINUTE = 0.0005;
/**
 * Replicate's most expensive listed GPU (H100, replicate.com/pricing,
 * 2026-11-11). Both Replicate models list T4 ($0.000225/s); pricing at the
 * top rate covers a hardware change.
 */
export const REPLICATE_MAX_USD_PER_SECOND = 0.001525;

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
  // Snippet and language name at their token caps; the system prompt and
  // "Language: ... Code:" wrapper fit inside PROMPT_OVERHEAD_TOKENS
  // (cost-model.test.ts checks their length).
  llmCase('explain-code-pro', [
    {
      model: EXPLAIN_CODE.model,
      inputTokens: limitTokens('explain-code-pro'),
      maxOutputTokens: EXPLAIN_CODE.maxOutputTokens,
    },
  ]),
  {
    toolId: 'image-generate-pro',
    detail: `flux-1-schnell: ${FLUX_OUTPUT_TILES} tiles, ${MAX_STEPS} steps`,
    usd: FLUX_OUTPUT_TILES * FLUX_USD_PER_TILE + MAX_STEPS * FLUX_USD_PER_STEP,
  },
  whisperCase('transcribe-pro', []),
  // Whisper, then Llama 3.3 on the transcript (trimmed to its token cap).
  whisperCase('transcribe-and-translate', [
    {
      model: TEXT_MODEL,
      inputTokens: TRANSCRIPT_TRANSLATE_MAX_TOKENS + TARGET_CHARS,
      maxOutputTokens: MAX_TOKENS.default,
    },
  ]),
  // Gemma 4 with output capped at 1.5x the input estimate + 128 tokens.
  // Source and target names (<= 100 chars each) go in the system prompt.
  llmCase('translate-many-pro', [
    translateCall(limitTokens('translate-many-pro'), 2 * TARGET_CHARS),
  ]),
  llmCase('translate-indic-pro', [translateCall(limitTokens('translate-indic-pro'), 0)]),
  documentCase(),
  replicateCase('bg-remove-pro'),
  replicateCase('upscale-2x-pro'),
];

/**
 * Priced tools whose worst case cannot be bounded, with the reason. Empty
 * since 2026-11-11: every such tool was bounded or removed (detect-objects).
 * A tool listed here must still be priced deliberately; the test requires
 * every priced tool to be modelled above or explained here.
 */
export const UNBOUNDED_TOOLS: Readonly<Record<string, string>> = {};

function whisperCase(toolId: string, extraCalls: LlmCall[]): WorstCase {
  const minutes = Math.ceil(HOSTED_AUDIO_MAX_SECONDS / 60);
  const whisperUsd = minutes * WHISPER_USD_PER_MINUTE;
  const extra = extraCalls.length ? llmCase(toolId, extraCalls) : undefined;
  return {
    toolId,
    detail:
      `whisper-large-v3-turbo: ${minutes} min at $${WHISPER_USD_PER_MINUTE}/min` +
      (extra ? ` + ${extra.detail}` : ''),
    usd: whisperUsd + (extra?.usd ?? 0),
  };
}

function translateCall(inputTokens: number, nameTokens: number): LlmCall {
  return {
    model: TRANSLATE_MODEL,
    inputTokens: inputTokens + nameTokens,
    maxOutputTokens:
      Math.ceil(inputTokens * TRANSLATE_OUTPUT_FACTOR) + TRANSLATE_OUTPUT_EXTRA_TOKENS,
  };
}

// translate-document-pro: up to MAX_DOC_CHUNKS calls. Chunk estimates sum
// to at most the document cap plus one token per chunk (rounding); each
// call adds the prompt overhead and both language names, and its output
// is capped at 1.5x its own input estimate + 128 (+1 for rounding).
function documentCase(): WorstCase {
  const toolId = 'translate-document-pro';
  const chunks = MAX_DOC_CHUNKS;
  const textTokens = limitTokens(toolId) + chunks;
  const price = TOKEN_PRICES[TRANSLATE_MODEL];
  const inputTokens = textTokens + chunks * (PROMPT_OVERHEAD_TOKENS + 2 * TARGET_CHARS);
  const outputTokens =
    textTokens * TRANSLATE_OUTPUT_FACTOR + chunks * (TRANSLATE_OUTPUT_EXTRA_TOKENS + 1);
  return {
    toolId,
    detail: `${TRANSLATE_MODEL} x ${chunks} chunks: ${inputTokens} in, ${Math.ceil(outputTokens)} out in total`,
    usd: (inputTokens * price.inPerM + outputTokens * price.outPerM) / 1e6,
  };
}

function replicateCase(toolId: string): WorstCase {
  return {
    toolId,
    detail: `Replicate: Cancel-After ${REPLICATE_CANCEL_AFTER_SECONDS}s at $${REPLICATE_MAX_USD_PER_SECOND}/s (H100, the dearest listed GPU)`,
    usd: REPLICATE_CANCEL_AFTER_SECONDS * REPLICATE_MAX_USD_PER_SECOND,
  };
}

export function floorUsd(toolId: string): number {
  const credits = PRICING[toolId];
  if (credits === undefined) throw new Error(`No price for ${toolId}`);
  return credits * WORST_NET_USD_PER_CREDIT * MAX_COST_SHARE;
}
