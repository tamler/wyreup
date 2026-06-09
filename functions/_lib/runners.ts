// Hosted-model dispatchers for PRO tools.
//
// One async function per PRO tool ID. `runPro` selects the right one by
// toolId. Each runner is responsible for shaping the input it receives
// from the client, calling its provider (Workers AI for text/audio; the
// providers/image-models.ts wrapper for images), and returning a
// JSON-serializable result.
//
// Conventions:
//   - Throw on any failure — the caller (api/tools/pro/run.ts) catches
//     and triggers the credit refund.
//   - Return plain JSON: text outputs as strings, image outputs as
//     { url: string } pointing at a temporary signed URL (provider-hosted),
//     not base64 — keeps the response small.
//   - The client `input` is untrusted. Validate shape before calling.

import type { Env } from './env';
import { runBgRemove, runUpscale } from './providers/image-models';
import { chat, chatWith } from './providers/text-models';
import { withTimeout, INFERENCE_TIMEOUTS, MAX_TOKENS } from './timeout';
import { transcribe as runTranscribe } from './providers/audio-models';
import { visionPrompt, detectObjects } from './providers/vision-models';
import { synthesize, TTS_MAX_CHARS, type TtsLang } from './providers/tts-models';
import {
  translateMany as runTranslateMany,
  translateIndic as runTranslateIndic,
  type IndicLang,
} from './providers/translate-models';
import { generateImage } from './providers/image-gen-models';

// Workers AI model IDs for the Wave-1 Pro tools. Centralized so swapping
// a model only touches this block.
const MODEL_GUARD = '@cf/meta/llama-guard-3-8b';
const MODEL_DEEPSEEK = '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';
const MODEL_LLAMA_SMALL = '@cf/meta/llama-3.2-3b-instruct';
const MODEL_GLM_FLASH = '@cf/zai-org/glm-4.7-flash';
// MODEL_SCOUT — Llama 4 Scout, used for both json-extract-pro and
// chat-long-pdf-pro. 10M token context window (succeeds kimi-k2.5 here
// — k2.5 was planned-deprecation and k2.6 raised input/output pricing
// 60%, eating margin on a 2-credit tool). Scout is ~3-4× cheaper per
// token than the kimi family at typical sizes, and the bigger context
// means we can take genuinely huge PDFs without chunking.
const MODEL_SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';

export type RunnerInput = Record<string, unknown>;
export type RunnerOutput = unknown;

export async function runPro(
  toolId: string,
  input: RunnerInput,
  env: Env,
): Promise<RunnerOutput> {
  const runner = RUNNERS[toolId];
  if (!runner) {
    throw new Error(`No hosted runner registered for tool '${toolId}'`);
  }
  return runner(input, env);
}

type Runner = (input: RunnerInput, env: Env) => Promise<RunnerOutput>;

const RUNNERS: Record<string, Runner> = {
  'transcribe-pro': transcribePro,
  'text-summarize-pro': summarizePro,
  'text-translate-pro': translatePro,
  'text-sentiment-pro': sentimentPro,
  'text-ner-pro': nerPro,
  'text-redact-pro': redactPro,
  'bg-remove-pro': bgRemovePro,
  'upscale-2x-pro': upscalePro,
  'ocr-hq': ocrHq,
  'image-describe': imageDescribe,
  'analyze-chart': analyzeChart,
  'image-q-and-a': imageQandA,
  'read-handwriting': readHandwriting,
  'detect-objects': detectObjectsPro,
  'translate-image': translateImage,
  'transcribe-and-translate': transcribeAndTranslate,
  'regex-from-text-pro': regexFromTextPro,
  'cron-from-text-pro': cronFromTextPro,
  'pdf-summarize': pdfSummarize,
  'pdf-q-and-a': pdfQandA,
  'text-to-speech-pro': textToSpeechPro,
  'content-safety-pro': contentSafetyPro,
  'translate-many-pro': translateManyPro,
  'deep-analysis-pro': deepAnalysisPro,
  'fix-grammar-pro': fixGrammarPro,
  'rewrite-tone-pro': rewriteTonePro,
  'chat-long-pdf-pro': chatLongPdfPro,
  'image-generate-pro': imageGeneratePro,
  'json-extract-pro': jsonExtractPro,
  'translate-indic-pro': translateIndicPro,
};

// ────────────────────────────────────────────────────────────────────────
// Workers AI — transcription
// ────────────────────────────────────────────────────────────────────────

interface TranscribeInput {
  /** base64-encoded audio bytes (mp3/wav/m4a). */
  audioBase64?: string;
  /** Optional language hint (ISO 639-1). */
  language?: string;
}

// 25 MB — same as the client-side input.sizeLimit on transcribe-pro. Caps
// the per-run inference cost so a malicious caller can't bypass the
// client check and burn margin with a 10-hour file for 5 credits.
const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

async function transcribePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const input = raw as TranscribeInput;
  const bytes = __readAudioBytes(raw);
  return runTranscribe(env, { bytes, language: input.language });
}

// ────────────────────────────────────────────────────────────────────────
// Text tools — go through the swappable text-model wrapper
// ────────────────────────────────────────────────────────────────────────

async function summarizePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const out = await chat(
    env,
    'You summarize text. Return a tight 3-5 sentence summary. No preamble, no "Here is the summary" — just the summary itself.',
    text,
  );
  return { summary: out };
}

async function translatePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const target =
    typeof (raw as Record<string, unknown>).target === 'string'
      ? ((raw as Record<string, unknown>).target as string)
      : 'English';
  const out = await chat(
    env,
    `You are a translator. Translate the user message into ${target}. Return ONLY the translation. No commentary, no original text, no quotation marks.`,
    text,
  );
  return { translation: out, target };
}

async function sentimentPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const out = await chat(
    env,
    'Classify the sentiment of the user message. Respond with EXACTLY one word: positive, negative, or neutral. No punctuation, no explanation.',
    text,
  );
  const label = out.toLowerCase().replace(/[^a-z]/g, '');
  const known = ['positive', 'negative', 'neutral'].includes(label) ? label : 'neutral';
  return { sentiment: known };
}

async function nerPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const out = await chat(
    env,
    `Extract named entities from the user message. Reply with JSON only, no preamble. Schema:
{"entities":[{"text":"...","type":"PERSON|ORG|LOCATION|DATE|MONEY|OTHER"}]}`,
    text,
  );
  const parsed = tryParseJson(out);
  if (!parsed || !Array.isArray((parsed as { entities?: unknown }).entities)) {
    throw new Error('NER model returned unparseable output');
  }
  return parsed;
}

async function redactPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const out = await chat(
    env,
    `Redact PII from the user message. Replace any names, emails, phone numbers, addresses, SSN, or credit-card-like numbers with [REDACTED]. Return ONLY the redacted text — no preamble, no JSON.`,
    text,
  );
  return { redacted: out };
}

// ────────────────────────────────────────────────────────────────────────
// Image tools — go through the swappable provider wrapper
// ────────────────────────────────────────────────────────────────────────

async function bgRemovePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const imageUrl = readImageRef(raw);
  return runBgRemove({ image: imageUrl }, env);
}

async function upscalePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const imageUrl = readImageRef(raw);
  const scale = (raw as Record<string, unknown>).scale === 4 ? 4 : 2;
  return runUpscale({ image: imageUrl, scale }, env);
}

// ────────────────────────────────────────────────────────────────────────
// Vision tools — Workers AI vision model via the vision-models wrapper
// ────────────────────────────────────────────────────────────────────────

async function analyzeChart(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const analysis = await visionPrompt(
    env,
    image,
    'This image is a chart, graph, or diagram. Identify the chart type, then summarize the data and the main trend or takeaway in plain text. List key data points if readable. Return ONLY the analysis.',
  );
  return { analysis };
}

async function imageDescribe(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const description = await visionPrompt(
    env,
    image,
    'Describe this image in 1-3 clear sentences suitable as alt-text. Be factual and concise. Return ONLY the description.',
  );
  return { description };
}

async function imageQandA(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const question = readText(raw, 'question');
  const answer = await visionPrompt(
    env,
    image,
    `Answer this question about the image based only on what is visible. Question: ${question}\nReturn ONLY the answer.`,
  );
  return { answer };
}

async function readHandwriting(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const text = await visionPrompt(
    env,
    image,
    'This image contains handwritten text. Transcribe the handwriting as accurately as possible, preserving line breaks. If a word is illegible, write [illegible]. Return ONLY the transcription.',
  );
  return { text };
}

async function detectObjectsPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const found = await detectObjects(env, image);
  // Highest-confidence first; round scores for a clean UI / chainable JSON.
  const objects = found
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((o) => ({
      label: o.label,
      score: Math.round(o.score * 1000) / 1000,
      box: o.box,
    }));
  return { objects, count: objects.length };
}

async function ocrHq(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const text = await visionPrompt(
    env,
    image,
    'Extract all text from this image exactly as it appears, preserving line breaks and reading order. Return ONLY the extracted text — no commentary, no description.',
  );
  return { text };
}

// ────────────────────────────────────────────────────────────────────────
// Chain tools — combine more than one model in a single runner
// ────────────────────────────────────────────────────────────────────────

async function translateImage(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const image = __readImageBytes(raw);
  const rawTarget = (raw as Record<string, unknown>).target;
  const target =
    typeof rawTarget === 'string' && rawTarget.trim().length > 0
      ? rawTarget.trim()
      : 'English';

  const sourceText = await visionPrompt(
    env,
    image,
    'Extract all text from this image exactly as it appears. Return ONLY the text.',
  );
  if (sourceText.trim().length === 0) {
    throw new Error('No text found in the image to translate');
  }
  const translation = await chat(
    env,
    `You are a translator. Translate the user message into ${target}. Return ONLY the translation — no commentary, no original text, no quotation marks.`,
    sourceText,
  );
  return { sourceText, translation, target };
}

async function transcribeAndTranslate(
  raw: RunnerInput,
  env: Env,
): Promise<RunnerOutput> {
  const input = raw as TranscribeInput;
  const bytes = __readAudioBytes(raw);
  const rawTarget = (raw as Record<string, unknown>).target;
  const target =
    typeof rawTarget === 'string' && rawTarget.trim().length > 0
      ? rawTarget.trim()
      : 'English';

  const { text: transcript } = await runTranscribe(env, {
    bytes,
    language: input.language,
  });
  if (transcript.trim().length === 0) {
    throw new Error('No speech found in the audio to translate');
  }
  const translation = await chat(
    env,
    `You are a translator. Translate the user message into ${target}. Return ONLY the translation — no commentary, no original text, no quotation marks.`,
    transcript,
  );
  return { transcript, translation, target };
}

// ────────────────────────────────────────────────────────────────────────
// Upgrade-seam tools — LLM fallback for the free heuristic from-text tools
// (regex-from-text, cron-from-text) when they return confidence: no-match.
// ────────────────────────────────────────────────────────────────────────

async function regexFromTextPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const description = readText(raw, 'description');
  const out = await chat(
    env,
    'You generate JavaScript regular expressions from natural-language descriptions. ' +
      'Reply with ONLY a JSON object — no markdown, no preamble — of the form ' +
      '{"pattern":"...","flags":"...","explanation":"..."}. "pattern" is the regex body ' +
      'with no enclosing slashes. "flags" is the flag string (e.g. "g", "gi"), or "" if none. ' +
      '"explanation" is one plain sentence.',
    description,
  );
  const parsed = tryParseJson(out) as
    | { pattern?: unknown; flags?: unknown; explanation?: unknown }
    | null;
  if (!parsed || typeof parsed.pattern !== 'string') {
    throw new Error('Regex model returned unparseable output');
  }
  const pattern = parsed.pattern;
  const flags = typeof parsed.flags === 'string' ? parsed.flags : '';
  return {
    pattern,
    flags,
    fullRegex: `/${pattern}/${flags}`,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
  };
}

async function cronFromTextPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const description = readText(raw, 'description');
  const out = await chat(
    env,
    'You convert natural-language schedule descriptions into standard 5-field cron ' +
      'expressions (minute hour day-of-month month day-of-week). Reply with ONLY a JSON ' +
      'object — no markdown, no preamble — of the form {"cron":"...","explanation":"..."}. ' +
      '"cron" is the 5-field expression. "explanation" is one plain sentence.',
    description,
  );
  const parsed = tryParseJson(out) as { cron?: unknown; explanation?: unknown } | null;
  if (!parsed || typeof parsed.cron !== 'string') {
    throw new Error('Cron model returned unparseable output');
  }
  return {
    cron: parsed.cron,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Document tools — LLM over text the client extracted from a PDF
// ────────────────────────────────────────────────────────────────────────

async function pdfSummarize(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const summary = await chat(
    env,
    'You summarize documents. Return a tight, well-structured summary in ' +
      '4-8 sentences covering the key points and conclusions. No preamble — ' +
      'just the summary itself.',
    text,
  );
  return { summary };
}

async function pdfQandA(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const question = readText(raw, 'question');
  const answer = await chat(
    env,
    'You answer questions about a document. Use ONLY the information in the ' +
      'document below. If the answer is not in the document, say so plainly. ' +
      'Return only the answer — no preamble.',
    `Document:\n${text}\n\nQuestion: ${question}`,
  );
  return { answer };
}

// ────────────────────────────────────────────────────────────────────────
// Wave 1 — Workers AI expansion (2026-05-22)
// ────────────────────────────────────────────────────────────────────────

async function textToSpeechPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  if (text.length > TTS_MAX_CHARS) {
    throw new Error(`text exceeds ${TTS_MAX_CHARS} characters`);
  }
  const langRaw = (raw as Record<string, unknown>).language;
  const language: TtsLang =
    typeof langRaw === 'string' && /^[A-Z]{2}$/.test(langRaw) ? (langRaw as TtsLang) : 'EN';
  return synthesize(env, { text, language });
}

// Llama Guard 3 has its own trained safety template — passing a custom
// system prompt fights the model. Send just the user content and let the
// built-in template produce the canonical "safe" or "unsafe\nS1,S2,..."
// classification. Then throw on empty/unrecognized output so the caller
// refunds the credit instead of returning a silent false-negative.
async function contentSafetyPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const res = (await withTimeout(
    env.AI.run(MODEL_GUARD, {
      messages: [{ role: 'user', content: text }],
      max_tokens: MAX_TOKENS.classification,
    }),
    INFERENCE_TIMEOUTS.text,
    'llama-guard',
  )) as { response?: string };
  const out = typeof res?.response === 'string' ? res.response.trim() : '';
  if (!out) {
    throw new Error('Safety classifier returned no output');
  }
  const lines = out
    .toLowerCase()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const first = lines[0];
  if (first !== 'safe' && first !== 'unsafe') {
    throw new Error('Safety classifier returned unrecognized output');
  }
  const safe = first === 'safe';
  const categories = safe
    ? []
    : (lines[1] ?? '')
        .split(/[,\s]+/)
        .map((s) => s.toUpperCase())
        .filter((s) => /^S\d+$/.test(s));
  return { safe, categories, raw: out };
}

async function translateManyPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const target = readText(raw, 'target');
  const sourceRaw = (raw as Record<string, unknown>).source;
  const source = typeof sourceRaw === 'string' && sourceRaw.length > 0 ? sourceRaw : 'en';
  const result = await runTranslateMany(env, { text, source, target });
  return { ...result, source, target };
}

// DeepSeek R1 emits a <think>...</think> reasoning trace before the final
// answer. We return both so callers can show or hide the reasoning.
async function deepAnalysisPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const question = readText(raw, 'question');
  const out = await chatWith(
    env,
    MODEL_DEEPSEEK,
    'You are a careful analyst. Read the document, then answer the question with explicit reasoning. Cite specific passages from the document.',
    `Document:\n${text}\n\nQuestion: ${question}`,
    { maxTokens: MAX_TOKENS.reasoning },
  );
  const thinkMatch = out.match(/<think>([\s\S]*?)<\/think>/i);
  const reasoning = thinkMatch?.[1]?.trim() ?? '';
  // R1 sometimes returns its full answer inside the <think> block and
  // nothing after the closing tag. Fall back to the reasoning so the
  // user gets a usable answer; only throw if the whole output is empty.
  let answer = out.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
  if (!answer) answer = reasoning;
  if (!answer) {
    throw new Error('Analysis model returned no answer');
  }
  return { answer, reasoning };
}

async function fixGrammarPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const corrected = await chatWith(
    env,
    MODEL_LLAMA_SMALL,
    'You are a copy editor. Fix grammar, spelling, and punctuation. Preserve the author’s voice and meaning. Return ONLY the corrected text — no explanations, no preamble, no quotes.',
    text,
  );
  return { corrected };
}

async function rewriteTonePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const toneRaw = (raw as Record<string, unknown>).tone;
  const tone =
    typeof toneRaw === 'string' &&
    ['formal', 'casual', 'kid-friendly', 'concise', 'professional', 'friendly'].includes(toneRaw)
      ? toneRaw
      : 'professional';
  const rewritten = await chatWith(
    env,
    MODEL_GLM_FLASH,
    `Rewrite the user message in a ${tone} tone. Preserve the meaning. Return ONLY the rewritten text — no preamble, no quotes.`,
    text,
  );
  return { rewritten, tone };
}

async function chatLongPdfPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const question = readText(raw, 'question');
  const answer = await chatWith(
    env,
    MODEL_SCOUT,
    'You answer questions about long documents. Use ONLY the document below. If the answer is not present, say so plainly. Return only the answer.',
    `Document:\n${text}\n\nQuestion: ${question}`,
    { maxTokens: MAX_TOKENS.reasoning },
  );
  return { answer };
}

async function imageGeneratePro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const prompt = readText(raw, 'prompt');
  const stepsRaw = (raw as Record<string, unknown>).steps;
  const steps = typeof stepsRaw === 'number' && Number.isFinite(stepsRaw) ? stepsRaw : 4;
  return generateImage(env, { prompt, steps });
}

async function jsonExtractPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const schemaRaw = (raw as Record<string, unknown>).schema;
  const schemaHint =
    typeof schemaRaw === 'string' && schemaRaw.trim().length > 0
      ? schemaRaw.trim()
      : 'Pick the most descriptive fields you can find. Use snake_case keys.';
  const out = await chatWith(
    env,
    MODEL_SCOUT,
    'You extract structured data from text. Reply with ONLY a valid JSON object — no markdown, no preamble, no explanation. If a field is not present, omit it rather than guessing.',
    `Schema hint: ${schemaHint}\n\nText:\n${text}`,
  );
  const parsed = tryParseJson(out);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Extraction model returned unparseable JSON');
  }
  return { data: parsed };
}

async function translateIndicPro(raw: RunnerInput, env: Env): Promise<RunnerOutput> {
  const text = readText(raw, 'text');
  const targetRaw = (raw as Record<string, unknown>).target;
  const allowed: IndicLang[] = [
    'hin_Deva',
    'ben_Beng',
    'tam_Taml',
    'tel_Telu',
    'mar_Deva',
    'guj_Gujr',
    'pan_Guru',
    'mal_Mlym',
    'kan_Knda',
    'urd_Arab',
    'asm_Beng',
  ];
  const target: IndicLang =
    typeof targetRaw === 'string' && allowed.includes(targetRaw as IndicLang)
      ? (targetRaw as IndicLang)
      : 'hin_Deva';
  const result = await runTranslateIndic(env, { text, target });
  return { ...result, target };
}

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

function readText(raw: RunnerInput, field: string): string {
  const v = (raw as Record<string, unknown>)[field];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`'${field}' (non-empty string) is required`);
  }
  if (v.length > 100_000) {
    throw new Error(`'${field}' exceeds 100k chars`);
  }
  return v;
}

// Block hostnames that resolve to private/loopback/link-local/reserved
// ranges, defeating SSRF against internal services and the cloud metadata
// endpoint. The image provider fetches this URL server-side, so a bare
// startsWith('http') check would let a caller reach http://169.254.169.254
// etc. Exported as __isDisallowedHost for unit testing only.
export function __isDisallowedHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  // Strip IPv6 brackets if present.
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  if (h === 'localhost' || h.endsWith('.local')) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — unwrap to the embedded IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped) h = mapped[1];

  // IPv6 loopback / link-local / unique-local.
  if (h === '::1') return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb'))
    return true; // fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7

  // IPv4 literal ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true;
    const [a, b] = o;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 0) return true; // 0.0.0.0/8
  }
  return false;
}

// Exported as __readImageRef for unit testing only.
export function readImageRef(raw: RunnerInput): string {
  // Accept either a public https URL or a data:image/ URL. data: URLs keep
  // the bytes client-side; URLs are fetched server-side by the image
  // provider, so they must be https to a public host (see __isDisallowedHost).
  const v = (raw as Record<string, unknown>).image;
  if (typeof v === 'string' && v.startsWith('data:image/')) {
    return v;
  }
  if (typeof v === 'string' && v.startsWith('https://')) {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new Error("'image' must be an https URL to a public host or a data: URL");
    }
    if (url.protocol !== 'https:' || __isDisallowedHost(url.hostname)) {
      throw new Error("'image' must be an https URL to a public host or a data: URL");
    }
    return v;
  }
  throw new Error("'image' must be an https URL to a public host or a data: URL");
}

function tryParseJson(s: string): unknown {
  // Models occasionally wrap JSON in ```json fences — strip them.
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// 10 MB cap on vision inputs — bounds the per-run inference cost so a
// malicious caller can't bypass the client check. Exported as
// __readImageBytes for unit testing only.
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function __readImageBytes(raw: RunnerInput): Uint8Array {
  const v = (raw as Record<string, unknown>).imageBase64;
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('imageBase64 required');
  }
  if (v.length > Math.ceil(IMAGE_MAX_BYTES * 1.4)) {
    throw new Error(`Image exceeds ${IMAGE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  const bytes = base64ToUint8Array(v);
  if (bytes.length > IMAGE_MAX_BYTES) {
    throw new Error(`Image exceeds ${IMAGE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  return bytes;
}

// Decodes the base64 `audioBase64` field and enforces the two-phase
// TRANSCRIBE_MAX_BYTES cap. Shared by transcribePro and transcribeAndTranslate.
// Exported as __readAudioBytes for unit testing only.
export function __readAudioBytes(raw: RunnerInput): Uint8Array {
  const v = (raw as Record<string, unknown>).audioBase64;
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('audioBase64 required');
  }
  // Cheap upper bound check before base64 decode (base64 is ~4/3 raw size).
  if (v.length > Math.ceil(TRANSCRIBE_MAX_BYTES * 1.4)) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  const bytes = base64ToUint8Array(v);
  if (bytes.length > TRANSCRIBE_MAX_BYTES) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  return bytes;
}

function base64ToUint8Array(b64: string): Uint8Array {
  // Strip data: prefix if present.
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
