// text-checklist-pro: yes/no, pick-one and score questions about a pasted
// text, answered with probabilities by Cloudflare's clef-flash decision model.
//
// clef-flash takes { model, state, questions } and returns one answer per
// question id. It bills input tokens only ($0.038 per M) and never more than
// its 24,576-token context: questions that overflow fail the request, and a
// long text state is truncated to fit. The caps below keep the largest
// request inside that window even at 1 token per character, so the model
// never silently drops the end of the user's text.
//
// Text only. clef-flash also reads images, but media token cost is not
// measured for this tool, so `images` is never sent.
//
// One call per run: no retry, no fallback model.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS } from '../timeout';

export const MODEL_CLEF_FLASH = '@cf/cloudflare/clef-flash';
/** clef-flash context window, tokens (model page, 2026-11-11). */
export const CLEF_FLASH_CONTEXT_TOKENS = 24_576;
/** clef-flash list price, USD per million input tokens. Output is free. */
export const CLEF_FLASH_USD_PER_M_INPUT = 0.038;

export const CHECKLIST_LIMITS = {
  maxTextChars: 16_000,
  maxQuestions: 10,
  maxQuestionChars: 200,
  minOptions: 2,
  maxOptions: 10,
  maxOptionChars: 40,
} as const;

export type ChecklistKind = 'yes-no' | 'pick-one' | 'score';

export interface ChecklistQuestion {
  kind: ChecklistKind;
  question: string;
  /** pick-one: the options. score: ordered levels, lowest first. */
  options?: string[];
}

export type ChecklistResult =
  | { question: string; kind: 'yes-no'; yes: number; no: number }
  | {
      question: string;
      kind: 'pick-one';
      answer: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | {
      question: string;
      kind: 'score';
      /** Probability-weighted level, 0 = lowest. Can land between levels. */
      score: number;
      /** The level the score rounds to. */
      nearest: string;
      confidence: number;
      probabilities: Record<string, number>;
    };

type ClefQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface ClefRequest {
  model: 'clef-flash';
  state: string;
  questions: Record<string, ClefQuestion>;
}

const KINDS: readonly ChecklistKind[] = ['yes-no', 'pick-one', 'score'];

/** Validate untrusted client input. Throws before any provider work. */
export function readChecklistInput(raw: Record<string, unknown>): {
  text: string;
  questions: ChecklistQuestion[];
} {
  const L = CHECKLIST_LIMITS;
  const text = raw.text;
  if (typeof text !== 'string' || text.trim().length === 0)
    throw new Error("'text' (non-empty string) is required");
  if (text.length > L.maxTextChars) throw new Error(`'text' exceeds ${L.maxTextChars} characters`);

  const list = raw.questions;
  if (!Array.isArray(list) || list.length === 0)
    throw new Error("'questions' must be a non-empty array");
  if (list.length > L.maxQuestions) throw new Error(`At most ${L.maxQuestions} questions per run`);

  const questions = list.map((item, i): ChecklistQuestion => {
    const n = i + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`Question ${n} must be an object`);
    const { kind, question, options } = item as Record<string, unknown>;
    if (typeof kind !== 'string' || !KINDS.includes(kind as ChecklistKind))
      throw new Error(`Question ${n} has an unknown kind`);
    if (typeof question !== 'string' || question.trim().length === 0)
      throw new Error(`Question ${n} is empty`);
    if (question.length > L.maxQuestionChars)
      throw new Error(`Question ${n} exceeds ${L.maxQuestionChars} characters`);
    if (kind === 'yes-no') {
      if (options !== undefined) throw new Error(`Question ${n} is yes/no and takes no options`);
      return { kind, question: question.trim() };
    }
    if (!Array.isArray(options) || options.length < L.minOptions || options.length > L.maxOptions)
      throw new Error(`Question ${n} needs ${L.minOptions} to ${L.maxOptions} options`);
    const seen = new Set<string>();
    const clean = options.map((o) => {
      if (typeof o !== 'string' || o.trim().length === 0 || o.length > L.maxOptionChars)
        throw new Error(`Question ${n} options must be 1 to ${L.maxOptionChars} characters`);
      const key = o.trim().toLowerCase();
      if (seen.has(key)) throw new Error(`Question ${n} repeats an option`);
      seen.add(key);
      return o.trim();
    });
    return { kind: kind as ChecklistKind, question: question.trim(), options: clean };
  });
  return { text, questions };
}

export function buildClefRequest(text: string, questions: ChecklistQuestion[]): ClefRequest {
  const out: Record<string, ClefQuestion> = {};
  questions.forEach((q, i) => {
    const id = `q${i + 1}`;
    if (q.kind === 'yes-no') out[id] = { type: 'noul', instructions: q.question };
    else if (q.kind === 'pick-one')
      out[id] = {
        type: 'choice',
        instructions: q.question,
        criteria: Object.fromEntries(q.options!.map((o) => [o, null])),
      };
    else out[id] = { type: 'score', instructions: q.question, criteria: [...q.options!] };
  });
  return { model: 'clef-flash', state: text, questions: out };
}

const round = (p: number) => Math.round(p * 1000) / 1000;

function prob(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
    throw new Error(`Decision model returned an invalid ${what}`);
  return v;
}

/** Map clef answers back to the user's questions. Throws on any malformed answer. */
export function mapClefAnswers(res: unknown, questions: ChecklistQuestion[]): ChecklistResult[] {
  const body = (res ?? {}) as { answers?: unknown; result?: { answers?: unknown } };
  const answers = (body.answers ?? body.result?.answers) as Record<string, unknown> | undefined;
  if (!answers || typeof answers !== 'object')
    throw new Error('Decision model returned no answers');
  return questions.map((q, i) => {
    const a = answers[`q${i + 1}`] as Record<string, unknown> | undefined;
    if (!a || typeof a !== 'object') throw new Error('Decision model skipped a question');
    if (q.kind === 'yes-no') {
      const yes = prob(a.noul, 'probability');
      return { question: q.question, kind: 'yes-no', yes: round(yes), no: round(1 - yes) };
    }
    const p = a.probabilities as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') throw new Error('Decision model returned no probabilities');
    const confidence = round(prob(a.confidence, 'confidence'));
    if (q.kind === 'pick-one') {
      const probabilities = Object.fromEntries(
        q.options!.map((o) => [o, round(prob(p[o], 'probability'))]),
      );
      const answer =
        typeof a.choice === 'string' && q.options!.includes(a.choice) ? a.choice : null;
      if (!answer) throw new Error('Decision model picked an unknown option');
      return { question: q.question, kind: 'pick-one', answer, confidence, probabilities };
    }
    const levels = q.options!;
    const probabilities = Object.fromEntries(
      levels.map((l, idx) => [l, round(prob(p[String(idx)], 'probability'))]),
    );
    const score = a.score;
    if (
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > levels.length - 1
    )
      throw new Error('Decision model returned an invalid score');
    return {
      question: q.question,
      kind: 'score',
      score: Math.round(score * 100) / 100,
      nearest: levels[Math.round(score)],
      confidence,
      probabilities,
    };
  });
}

export function prepareChecklist(raw: Record<string, unknown>, env: Env): () => Promise<unknown> {
  const { text, questions } = readChecklistInput(raw);
  const request = buildClefRequest(text, questions);
  return async () => {
    const res = await withTimeout(
      env.AI.run(MODEL_CLEF_FLASH, request as never),
      INFERENCE_TIMEOUTS.text,
      `decision-model (${MODEL_CLEF_FLASH})`,
    );
    return { results: mapClefAnswers(res, questions) };
  };
}

/** Chat-template tokens clef wraps around the state and questions (allowance). */
export const CLEF_TEMPLATE_OVERHEAD_TOKENS = 512;

/** The largest request the caps allow, used by the cost model and its test. */
export function largestChecklistRequest(): ClefRequest {
  const L = CHECKLIST_LIMITS;
  const qs: ChecklistQuestion[] = Array.from({ length: L.maxQuestions }, (_, i) => ({
    kind: 'pick-one',
    question: 'Q'.repeat(L.maxQuestionChars),
    options: Array.from({ length: L.maxOptions }, (_, j) =>
      `${i}${j}`.padEnd(L.maxOptionChars, 'o'),
    ),
  }));
  return buildClefRequest('T'.repeat(L.maxTextChars), qs);
}

/** Input tokens of the largest request at 1 token per character, JSON syntax included. */
export function checklistMaxInputTokens(): number {
  return JSON.stringify(largestChecklistRequest()).length + CLEF_TEMPLATE_OVERHEAD_TOKENS;
}

/**
 * Worst-case Cloudflare USD for one run. clef bills at most its context window
 * of input tokens and nothing for output; one call, no retry or fallback.
 */
export function checklistWorstCaseUsd(): number {
  const tokens = Math.max(checklistMaxInputTokens(), CLEF_FLASH_CONTEXT_TOKENS);
  return (tokens * CLEF_FLASH_USD_PER_M_INPUT) / 1e6;
}
