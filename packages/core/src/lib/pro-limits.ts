// Per-tool input limits for hosted (Pro) tools, as a token upper bound.
//
// One source of truth: the browser, CLI and MCP check these in runPro()
// for a friendly error, and the server (functions/_lib/runners.ts)
// enforces the same table before any credit is reserved. The server's
// cost model (functions/_lib/cost-model.ts) prices every tool's worst case
// from these caps, so a run can never cost more than the margin floor
// allows, whatever the text contains.
//
// No imports: functions/ imports this file directly.

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Upper bound on the tokens any of our hosted models can produce for
 * `text`: its UTF-8 byte length (taking the larger of the raw and the NFKC
 * normalised form, since some tokenizers normalise first).
 *
 * Why it holds: byte-level BPE tokenizers (Llama 3 and 4, GLM, DeepSeek)
 * split the UTF-8 bytes into tokens of at least one byte each, and
 * SentencePiece with byte fallback (Gemma) emits at most one token per byte
 * for unknown characters and at least one character per known piece. So no
 * text can need more tokens than it has bytes. Chat templates add a fixed
 * number of special tokens, which the cost model counts as prompt
 * overhead. The old 1-per-3-characters estimate was not a bound: a run of
 * "1 " pairs or rare CJK tokenizes to 1 or 2 tokens per character.
 */
export function estimateTokens(text: string): number {
  const raw = utf8Length(text);
  const normalised = text.normalize('NFKC');
  return normalised === text ? raw : Math.max(raw, utf8Length(normalised));
}

/** Cap for a question, description or schema hint next to a main text. */
export const PRO_SHORT_FIELD_MAX_TOKENS = 1_500;

/** toolId -> field -> max tokens (UTF-8 bytes, see estimateTokens). */
export const PRO_TEXT_LIMITS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'text-summarize-pro': { text: 38_000 },
  'text-translate-pro': { text: 38_000 },
  'text-sentiment-pro': { text: 26_000 },
  'text-ner-pro': { text: 10_500 },
  'text-redact-pro': { text: 38_000 },
  'image-q-and-a': { question: PRO_SHORT_FIELD_MAX_TOKENS },
  'regex-from-text-pro': { description: 2_000 },
  'cron-from-text-pro': { description: 2_000 },
  'pdf-summarize': { text: 38_000 },
  'pdf-q-and-a': { text: 36_000, question: PRO_SHORT_FIELD_MAX_TOKENS },
  'content-safety-pro': { text: 15_500 },
  'deep-analysis-pro': { text: 34_000, question: PRO_SHORT_FIELD_MAX_TOKENS },
  'fix-grammar-pro': { text: 16_000 },
  'rewrite-tone-pro': { text: 100_000 },
  'chat-long-pdf-pro': { text: 44_000, question: PRO_SHORT_FIELD_MAX_TOKENS },
  'json-extract-pro': { text: 21_000, schema: PRO_SHORT_FIELD_MAX_TOKENS },
  'translate-many-pro': { text: 16_000 },
  'translate-indic-pro': { text: 16_000 },
  'translate-document-pro': { text: 48_000 },
};

/**
 * Returns the longest prefix of `text` within `maxTokens` (UTF-8 bytes),
 * cut at a whitespace boundary when one is near and never inside a
 * surrogate pair.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  // NFKC can only grow the count, so cut the normalised form's budget by
  // walking the raw text and re-checking.
  let end = 0;
  let bytes = 0;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    const pair = code >= 0xd800 && code <= 0xdbff && end + 1 < text.length;
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + width > maxTokens) break;
    bytes += width;
    end += pair ? 2 : 1;
  }
  const space = text.lastIndexOf(' ', end);
  if (space > end - 200 && space > 0) end = space;
  let out = text.slice(0, end);
  while (out && estimateTokens(out) > maxTokens) out = out.slice(0, Math.floor(out.length * 0.95));
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  text: 'The text',
  question: 'The question',
  description: 'The description',
  schema: 'The field description',
};

/** Hard character cap the server applies to every Pro text field. */
export const PRO_TEXT_MAX_CHARS = 100_000;

/**
 * "about 16,000 characters of English, or 5,333 of Chinese, Japanese or
 * Korean": English letters are one byte, CJK characters three.
 */
export function describeTokenLimit(maxTokens: number): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const english = Math.min(maxTokens, PRO_TEXT_MAX_CHARS);
  return `about ${fmt(english)} characters of English, or ${fmt(Math.floor(maxTokens / 3))} of Chinese, Japanese or Korean`;
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
