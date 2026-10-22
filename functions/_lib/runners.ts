// Hosted-model dispatchers for PRO tools.
//
// One preparation function per PRO tool ID. Each validates before returning
// an async dispatch closure. `prepareProRun` performs no provider work.
// Each runner is responsible for shaping the input it receives
// from the client, calling its provider (Workers AI for text/audio; the
// providers/image-models.ts wrapper for images), and returning a
// JSON-serializable result.
//
// Conventions:
//   - Throw on any failure — the caller (api/tools/pro/run.ts) catches
//     and triggers the credit refund.
//   - Return plain JSON; image providers return contentType/base64 inline.
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

export async function runPro(toolId: string, input: RunnerInput, env: Env): Promise<RunnerOutput> {
  return prepareProRun(toolId, input, env)();
}

export type PreparedProRun = () => Promise<RunnerOutput>;

export function prepareProRun(toolId: string, input: RunnerInput, env: Env): PreparedProRun {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Input object required');
  const runner = Object.prototype.hasOwnProperty.call(RUNNERS, toolId)
    ? RUNNERS[toolId]
    : undefined;
  if (!runner) {
    throw new Error(`No hosted runner registered for tool '${toolId}'`);
  }
  return runner(input, env);
}

type Runner = (input: RunnerInput, env: Env) => PreparedProRun;

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
  'translate-document-pro': translateDocumentPro,
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

// 25 MB — same as the client-side input.sizeLimit on transcribe-pro. Caps
// the per-run inference cost so a malicious caller can't bypass the
// client check and burn margin with a 10-hour file for 5 credits.
const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

function transcribePro(raw: RunnerInput, env: Env): PreparedProRun {
  const language = readOptionalText(raw, 'language', undefined, 32);
  const bytes = __readAudioBytes(raw);
  return () => runTranscribe(env, { bytes, language });
}

// ────────────────────────────────────────────────────────────────────────
// Text tools — go through the swappable text-model wrapper
// ────────────────────────────────────────────────────────────────────────

function summarizePro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
    const out = await chat(
      env,
      'You summarize text. Return a tight 3-5 sentence summary. No preamble, no "Here is the summary" — just the summary itself.',
      text,
    );
    return { summary: out };
  };
}

function translatePro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const target = readOptionalText(raw, 'target', 'English', 100);
  return async () => {
    const out = await chat(
      env,
      `You are a translator. Translate the user message into ${target}. Return ONLY the translation. No commentary, no original text, no quotation marks.`,
      text,
    );
    return { translation: out, target };
  };
}

function sentimentPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
    const out = await chat(
      env,
      'Classify the sentiment of the user message. Respond with EXACTLY one word: positive, negative, or neutral. No punctuation, no explanation.',
      text,
    );
    const label = out.toLowerCase().replace(/[^a-z]/g, '');
    const known = ['positive', 'negative', 'neutral'].includes(label) ? label : 'neutral';
    return { sentiment: known };
  };
}

function nerPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
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
  };
}

function redactPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
    const out = await chat(
      env,
      `Redact PII from the user message. Replace any names, emails, phone numbers, addresses, SSN, or credit-card-like numbers with [REDACTED]. Return ONLY the redacted text — no preamble, no JSON.`,
      text,
    );
    return { redacted: out };
  };
}

// ────────────────────────────────────────────────────────────────────────
// Image tools — go through the swappable provider wrapper
// ────────────────────────────────────────────────────────────────────────

function bgRemovePro(raw: RunnerInput, env: Env): PreparedProRun {
  const imageUrl = readImageRef(raw);
  return () => runBgRemove({ image: imageUrl }, env);
}

function upscalePro(raw: RunnerInput, env: Env): PreparedProRun {
  const imageUrl = readImageRef(raw);
  if (raw.scale !== undefined && raw.scale !== 2 && raw.scale !== 4)
    throw new Error('scale must be 2 or 4');
  const scale = raw.scale === 4 ? 4 : 2;
  return () => runUpscale({ image: imageUrl, scale }, env);
}

// ────────────────────────────────────────────────────────────────────────
// Vision tools — Workers AI vision model via the vision-models wrapper
// ────────────────────────────────────────────────────────────────────────

function analyzeChart(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  return async () => {
    const analysis = await visionPrompt(
      env,
      image,
      'This image is a chart, graph, or diagram. Identify the chart type, then summarize the data and the main trend or takeaway in plain text. List key data points if readable. Return ONLY the analysis.',
    );
    return { analysis };
  };
}

function imageDescribe(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  return async () => {
    const description = await visionPrompt(
      env,
      image,
      'Describe this image in 1-3 clear sentences suitable as alt-text. Be factual and concise. Return ONLY the description.',
    );
    return { description };
  };
}

function imageQandA(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  const question = readText(raw, 'question');
  return async () => {
    const answer = await visionPrompt(
      env,
      image,
      `Answer this question about the image based only on what is visible. Question: ${question}\nReturn ONLY the answer.`,
    );
    return { answer };
  };
}

function readHandwriting(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  return async () => {
    const text = await visionPrompt(
      env,
      image,
      'This image contains handwritten text. Transcribe the handwriting as accurately as possible, preserving line breaks. If a word is illegible, write [illegible]. Return ONLY the transcription.',
    );
    return { text };
  };
}

function detectObjectsPro(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  return async () => {
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
  };
}

function ocrHq(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  return async () => {
    const text = await visionPrompt(
      env,
      image,
      'Extract all text from this image exactly as it appears, preserving line breaks and reading order. Return ONLY the extracted text — no commentary, no description.',
    );
    return { text };
  };
}

// ────────────────────────────────────────────────────────────────────────
// Chain tools — combine more than one model in a single runner
// ────────────────────────────────────────────────────────────────────────

function translateImage(raw: RunnerInput, env: Env): PreparedProRun {
  const image = __readImageBytes(raw);
  const target = readOptionalText(raw, 'target', 'English', 100);
  return async () => {
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
  };
}

function transcribeAndTranslate(raw: RunnerInput, env: Env): PreparedProRun {
  const language = readOptionalText(raw, 'language', undefined, 32);
  const bytes = __readAudioBytes(raw);
  const target = readOptionalText(raw, 'target', 'English', 100);
  return async () => {
    const { text: transcript } = await runTranscribe(env, {
      bytes,
      language,
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
  };
}

// ────────────────────────────────────────────────────────────────────────
// Upgrade-seam tools — LLM fallback for the free heuristic from-text tools
// (regex-from-text, cron-from-text) when they return confidence: no-match.
// ────────────────────────────────────────────────────────────────────────

function regexFromTextPro(raw: RunnerInput, env: Env): PreparedProRun {
  const description = readText(raw, 'description');
  return async () => {
    const out = await chat(
      env,
      'You generate JavaScript regular expressions from natural-language descriptions. ' +
        'Reply with ONLY a JSON object — no markdown, no preamble — of the form ' +
        '{"pattern":"...","flags":"...","explanation":"..."}. "pattern" is the regex body ' +
        'with no enclosing slashes. "flags" is the flag string (e.g. "g", "gi"), or "" if none. ' +
        '"explanation" is one plain sentence.',
      description,
    );
    const parsed = tryParseJson(out) as {
      pattern?: unknown;
      flags?: unknown;
      explanation?: unknown;
    } | null;
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
  };
}

function cronFromTextPro(raw: RunnerInput, env: Env): PreparedProRun {
  const description = readText(raw, 'description');
  return async () => {
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
  };
}

// ────────────────────────────────────────────────────────────────────────
// Document tools — LLM over text the client extracted from a PDF
// ────────────────────────────────────────────────────────────────────────

function pdfSummarize(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
    const summary = await chat(
      env,
      'You summarize documents. Return a tight, well-structured summary in ' +
        '4-8 sentences covering the key points and conclusions. No preamble — ' +
        'just the summary itself.',
      text,
    );
    return { summary };
  };
}

function pdfQandA(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const question = readText(raw, 'question');
  return async () => {
    const answer = await chat(
      env,
      'You answer questions about a document. Use ONLY the information in the ' +
        'document below. If the answer is not in the document, say so plainly. ' +
        'Return only the answer — no preamble.',
      `Document:\n${text}\n\nQuestion: ${question}`,
    );
    return { answer };
  };
}

// ────────────────────────────────────────────────────────────────────────
// Wave 1 — Workers AI expansion (2026-05-22)
// ────────────────────────────────────────────────────────────────────────

function textToSpeechPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  if (text.length > TTS_MAX_CHARS) {
    throw new Error(`text exceeds ${TTS_MAX_CHARS} characters`);
  }
  const langRaw = readOptionalText(raw, 'language', 'EN', 2);
  if (!['EN', 'ES', 'FR', 'ZH', 'JP', 'KR'].includes(langRaw!))
    throw new Error('Unsupported TTS language');
  const language = langRaw as TtsLang;
  return () => synthesize(env, { text, language });
}

// Llama Guard 3 has its own trained safety template — passing a custom
// system prompt fights the model. Send just the user content and let the
// built-in template produce the canonical "safe" or "unsafe\nS1,S2,..."
// classification. Then throw on empty/unrecognized output so the caller
// refunds the credit instead of returning a silent false-negative.
function contentSafetyPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
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
  };
}

function translateManyPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const target = readLanguage(raw, 'target');
  const source = readOptionalText(raw, 'source', 'en', 100);
  return async () => {
    const result = await runTranslateMany(env, { text, source, target });
    return { ...result, source, target };
  };
}

const MAX_DOC_CHARS = 120_000;
const TRANSLATION_CHUNK_CHARS = 4_000;

export function __chunkDocumentText(text: string, maxChars = TRANSLATION_CHUNK_CHARS): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error('maxChars must be a positive integer');
  }

  const chunks: string[] = [];
  let offset = 0;
  while (text.length - offset > maxChars) {
    const window = text.slice(offset, offset + maxChars);
    const paragraphBreaks = [...window.matchAll(/\r?\n[\t ]*\r?\n/g)].filter(
      (match) => match.index !== 0,
    );
    const preferred = paragraphBreaks.at(-1);
    let splitAt = preferred?.index === undefined ? -1 : preferred.index + preferred[0].length;
    if (splitAt === -1) {
      // No paragraph break in the window: prefer the last whitespace so we
      // never cut a word in half — unless that would emit a chunk with no
      // actual content (window starting with leading whitespace).
      const lastSpace = window.search(/\s\S*$/);
      splitAt =
        lastSpace > 0 && window.slice(0, lastSpace + 1).trim().length > 0
          ? lastSpace + 1
          : maxChars;
    }
    // Never split a surrogate pair — a boundary between a high and low
    // surrogate would corrupt emoji/CJK-extension characters.
    const before = text.charCodeAt(offset + splitAt - 1);
    if (before >= 0xd800 && before <= 0xdbff && splitAt > 1) {
      splitAt -= 1;
    }
    chunks.push(text.slice(offset, offset + splitAt));
    offset += splitAt;
  }
  if (offset < text.length) chunks.push(text.slice(offset));
  return chunks;
}

function translateDocumentPro(raw: RunnerInput, env: Env): PreparedProRun {
  const textRaw = (raw as Record<string, unknown>).text;
  if (typeof textRaw !== 'string' || textRaw.trim().length === 0) {
    throw new Error("'text' (non-empty string) is required");
  }
  if (textRaw.length > MAX_DOC_CHARS) {
    throw new Error('Document exceeds the 40-page limit (120,000 characters maximum).');
  }

  const target = readLanguage(raw, 'target');
  const source = readOptionalText(raw, 'source', 'en', 100);
  const chunks = __chunkDocumentText(textRaw);
  return async () => {
    // Aggregate deadline: the char cap already bounds this to <=30 model
    // calls, but a slow provider must not stack thirty 30s timeouts.
    const DOC_RUN_DEADLINE_MS = 100_000;
    const startedAt = Date.now();
    const translations: string[] = [];
    for (const chunk of chunks) {
      if (Date.now() - startedAt > DOC_RUN_DEADLINE_MS) {
        throw new Error(
          'Translation is taking too long for this document — try a shorter document or split it.',
        );
      }
      const result = await runTranslateMany(env, { text: chunk, source, target });
      translations.push(result.translation);
    }

    return { text: translations.join('\n\n'), source, target, chunks: chunks.length };
  };
}

// DeepSeek R1 emits a <think>...</think> reasoning trace before the final
// answer. We return both so callers can show or hide the reasoning.
function deepAnalysisPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const question = readText(raw, 'question');
  return async () => {
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
  };
}

function fixGrammarPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  return async () => {
    const corrected = await chatWith(
      env,
      MODEL_LLAMA_SMALL,
      'You are a copy editor. Fix grammar, spelling, and punctuation. Preserve the author’s voice and meaning. Return ONLY the corrected text — no explanations, no preamble, no quotes.',
      text,
    );
    return { corrected };
  };
}

function rewriteTonePro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const tone = readOptionalText(raw, 'tone', 'professional', 32);
  if (!['formal', 'casual', 'kid-friendly', 'concise', 'professional', 'friendly'].includes(tone!))
    throw new Error('Unsupported tone');
  return async () => {
    const rewritten = await chatWith(
      env,
      MODEL_GLM_FLASH,
      `Rewrite the user message in a ${tone} tone. Preserve the meaning. Return ONLY the rewritten text — no preamble, no quotes.`,
      text,
    );
    return { rewritten, tone };
  };
}

function chatLongPdfPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const question = readText(raw, 'question');
  return async () => {
    const answer = await chatWith(
      env,
      MODEL_SCOUT,
      'You answer questions about long documents. Use ONLY the document below. If the answer is not present, say so plainly. Return only the answer.',
      `Document:\n${text}\n\nQuestion: ${question}`,
      { maxTokens: MAX_TOKENS.reasoning },
    );
    return { answer };
  };
}

function imageGeneratePro(raw: RunnerInput, env: Env): PreparedProRun {
  const prompt = readText(raw, 'prompt');
  const stepsRaw = (raw as Record<string, unknown>).steps;
  if (
    stepsRaw !== undefined &&
    (typeof stepsRaw !== 'number' || !Number.isInteger(stepsRaw) || stepsRaw < 1 || stepsRaw > 8)
  )
    throw new Error('steps must be an integer from 1 to 8');
  const steps = typeof stepsRaw === 'number' ? stepsRaw : 4;
  return () => generateImage(env, { prompt, steps });
}

function jsonExtractPro(raw: RunnerInput, env: Env): PreparedProRun {
  const text = readText(raw, 'text');
  const schemaHint = readOptionalText(
    raw,
    'schema',
    'Pick the most descriptive fields you can find. Use snake_case keys.',
    100_000,
  );
  return async () => {
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
  };
}

function translateIndicPro(raw: RunnerInput, env: Env): PreparedProRun {
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
  if (
    targetRaw !== undefined &&
    (typeof targetRaw !== 'string' || !allowed.includes(targetRaw as IndicLang))
  )
    throw new Error('Unsupported Indic language');
  const target = (targetRaw ?? 'hin_Deva') as IndicLang;
  return async () => {
    const result = await runTranslateIndic(env, { text, target });
    return { ...result, target };
  };
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

function readOptionalText(
  raw: RunnerInput,
  field: string,
  fallback: string | undefined,
  maxChars: number,
): string | undefined {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > maxChars)
    throw new Error(`Invalid '${field}'`);
  return value.trim();
}

function readLanguage(raw: RunnerInput, field: string): string {
  const value = readText(raw, field).trim();
  if (value.length > 100) throw new Error(`Invalid '${field}'`);
  return value;
}

// Uploaded bytes only: arbitrary URLs cannot be made safe by hostname checks
// because DNS resolution and redirects happen inside the upstream provider.
export function readImageRef(raw: RunnerInput): string {
  const v = (raw as Record<string, unknown>).image;
  if (typeof v !== 'string' || v.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 32)
    throw new Error('Image must be a PNG, JPEG, or WebP data URL up to 10 MB');
  const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(v);
  if (!prefix) throw new Error('Image must be a PNG, JPEG, or WebP data URL');
  const bytes = decodeBoundedBase64(v.slice(prefix[0].length), IMAGE_MAX_BYTES, 'Image');
  if (imageFormat(bytes) !== prefix[1])
    throw new Error('Image bytes do not match the declared format');
  return v;
}

function imageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp';
  return null;
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
  const bytes = decodeBoundedBase64(v.replace(/^data:[^;]+;base64,/, ''), IMAGE_MAX_BYTES, 'Image');
  if (bytes.length > IMAGE_MAX_BYTES) {
    throw new Error(`Image exceeds ${IMAGE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  if (!imageFormat(bytes)) throw new Error('Image must contain PNG, JPEG, or WebP bytes');
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
  const bytes = decodeBoundedBase64(
    v.replace(/^data:[^;]+;base64,/, ''),
    TRANSCRIBE_MAX_BYTES,
    'Audio',
  );
  if (bytes.length > TRANSCRIBE_MAX_BYTES) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  return bytes;
}

function decodeBoundedBase64(b64: string, maxBytes: number, label: string): Uint8Array {
  if (!b64 || b64.length > Math.ceil(maxBytes / 3) * 4)
    throw new Error(`${label} exceeds size cap or is empty`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error(`Invalid ${label} base64`);
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error(`Invalid ${label} base64`);
  }
  if (!binary.length || binary.length > maxBytes)
    throw new Error(`${label} exceeds size cap or is empty`);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
