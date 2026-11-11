// Per-tool input limits for hosted (Pro) tools, in estimated tokens.
//
// One source of truth: the browser, CLI and MCP check these in runPro()
// for a friendly error, and the server (functions/_lib/runners.ts)
// enforces the same table before any credit is reserved. The server's
// cost model (functions/_lib/cost-model.ts) prices every tool's worst case
// from these caps, so a run can never cost more than the margin floor
// allows, whatever language the text is in.
//
// No imports: functions/ imports this file directly.

/**
 * Conservative token estimate. ASCII counts at 1 token per 3 characters;
 * every non-ASCII UTF-16 code unit counts as a full token, so Chinese,
 * Japanese or Korean text costs 1 token per character and an emoji
 * (two code units) costs 2. Real tokenizers produce fewer tokens than this
 * for normal text, so the estimate errs on the side of the cap.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 0x80) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3) + other;
}

/** Default cap for a main text field: fits 100,000 characters of English. */
export const PRO_TEXT_MAX_TOKENS = 34_000;
/** Cap for a question, description or schema hint next to a main text. */
export const PRO_SHORT_FIELD_MAX_TOKENS = 700;

/** toolId -> field -> max estimated tokens. */
export const PRO_TEXT_LIMITS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'text-summarize-pro': { text: PRO_TEXT_MAX_TOKENS },
  'text-translate-pro': { text: PRO_TEXT_MAX_TOKENS },
  'text-sentiment-pro': { text: 24_000 },
  'text-ner-pro': { text: 8_000 },
  'text-redact-pro': { text: PRO_TEXT_MAX_TOKENS },
  'image-q-and-a': { question: PRO_SHORT_FIELD_MAX_TOKENS },
  'regex-from-text-pro': { description: 2_000 },
  'cron-from-text-pro': { description: 2_000 },
  'pdf-summarize': { text: PRO_TEXT_MAX_TOKENS },
  'pdf-q-and-a': { text: PRO_TEXT_MAX_TOKENS, question: PRO_SHORT_FIELD_MAX_TOKENS },
  'content-safety-pro': { text: 15_000 },
  'deep-analysis-pro': { text: PRO_TEXT_MAX_TOKENS, question: PRO_SHORT_FIELD_MAX_TOKENS },
  'fix-grammar-pro': { text: 4_000 },
  'rewrite-tone-pro': { text: PRO_TEXT_MAX_TOKENS },
  'chat-long-pdf-pro': { text: PRO_TEXT_MAX_TOKENS, question: PRO_SHORT_FIELD_MAX_TOKENS },
  'json-extract-pro': { text: 20_000, schema: PRO_SHORT_FIELD_MAX_TOKENS },
};

const FIELD_LABELS: Record<string, string> = {
  text: 'The text',
  question: 'The question',
  description: 'The description',
  schema: 'The field description',
};

/** Hard character cap the server applies to every Pro text field. */
export const PRO_TEXT_MAX_CHARS = 100_000;

/** "about 12,000 characters of English, or 4,000 of Chinese, Japanese or Korean" */
export function describeTokenLimit(maxTokens: number): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const english = Math.min(maxTokens * 3, PRO_TEXT_MAX_CHARS);
  return `about ${fmt(english)} characters of English, or ${fmt(maxTokens)} of Chinese, Japanese or Korean`;
}

/** Throws a readable error if any limited string field is over its cap. */
export function assertProTextLimits(toolId: string, input: Record<string, unknown>): void {
  const limits = Object.prototype.hasOwnProperty.call(PRO_TEXT_LIMITS, toolId)
    ? PRO_TEXT_LIMITS[toolId]
    : undefined;
  if (!limits) return;
  for (const [field, maxTokens] of Object.entries(limits)) {
    const value = input[field];
    if (typeof value !== 'string') continue;
    if (estimateTokens(value) > maxTokens) {
      throw new Error(
        `${FIELD_LABELS[field] ?? `'${field}'`} is too long for one run. The limit is ${describeTokenLimit(maxTokens)}. Shorten it or split it into parts.`,
      );
    }
  }
}
