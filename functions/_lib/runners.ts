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
import { chat } from './providers/text-models';
import { transcribe as runTranscribe } from './providers/audio-models';
import { visionPrompt, detectObjects } from './providers/vision-models';

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
  if (typeof input.audioBase64 !== 'string' || input.audioBase64.length === 0) {
    throw new Error('audioBase64 required');
  }
  // Cheap upper bound check before base64 decode (base64 is ~4/3 raw size).
  if (input.audioBase64.length > Math.ceil(TRANSCRIBE_MAX_BYTES * 1.4)) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }
  const bytes = base64ToUint8Array(input.audioBase64);
  if (bytes.length > TRANSCRIBE_MAX_BYTES) {
    throw new Error(`Audio exceeds ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB cap`);
  }

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

function readImageRef(raw: RunnerInput): string {
  // Accept either a public URL or a data: URL — the image provider
  // wrapper passes the value straight through.
  const v = (raw as Record<string, unknown>).image;
  if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:image/'))) {
    return v;
  }
  throw new Error("'image' must be an https URL or data: URL");
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

function base64ToUint8Array(b64: string): Uint8Array {
  // Strip data: prefix if present.
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
