import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  CHECKLIST_LIMITS,
  CLEF_FLASH_CONTEXT_TOKENS,
  MODEL_CLEF_FLASH,
  checklistMaxInputTokens,
  checklistWorstCaseUsd,
  mapClefAnswers,
  prepareChecklist,
  readChecklistInput,
} from './checklist-models';
import { CHECKLIST_CLIENT_LIMITS } from '../../../packages/core/src/tools/text-checklist-pro/questions';

const QUESTIONS = [
  { kind: 'yes-no', question: 'Is this urgent?' },
  { kind: 'pick-one', question: 'Which team?', options: ['billing', 'technical', 'sales'] },
  { kind: 'score', question: 'How severe?', options: ['none', 'minor', 'major', 'critical'] },
];

const CLEF_RESPONSE = {
  model: 'clef-flash',
  answers: {
    q1: { type: 'noul', noul: 0.9312 },
    q2: {
      type: 'choice',
      choice: 'technical',
      probabilities: { billing: 0.05, technical: 0.9, sales: 0.05 },
      confidence: 0.81,
    },
    q3: {
      type: 'score',
      score: 2.6,
      legend: { '0': 'none', '1': 'minor', '2': 'major', '3': 'critical' },
      probabilities: { '0': 0.01, '1': 0.04, '2': 0.3, '3': 0.65 },
      confidence: 0.5,
    },
  },
  usage: { input_tokens: 120, output_tokens: 0 },
};

function aiEnv(response: unknown) {
  const run = vi.fn((_model: string, _input: unknown) => Promise.resolve(response));
  return { env: { AI: { run } } as unknown as Env, run };
}

describe('text-checklist-pro provider', () => {
  it('sends one text-only clef-flash request and maps answers back in order', async () => {
    const { env, run } = aiEnv(CLEF_RESPONSE);
    const out = await prepareChecklist(
      { text: 'Checkout is down for everyone.', questions: QUESTIONS },
      env,
    )();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(MODEL_CLEF_FLASH);
    const payload = run.mock.calls[0]?.[1];
    expect(payload).not.toHaveProperty('images');
    expect(payload).toEqual({
      model: 'clef-flash',
      state: 'Checkout is down for everyone.',
      questions: {
        q1: { type: 'noul', instructions: 'Is this urgent?' },
        q2: {
          type: 'choice',
          instructions: 'Which team?',
          criteria: { billing: null, technical: null, sales: null },
        },
        q3: {
          type: 'score',
          instructions: 'How severe?',
          criteria: ['none', 'minor', 'major', 'critical'],
        },
      },
    });
    expect(out).toEqual({
      results: [
        { question: 'Is this urgent?', kind: 'yes-no', yes: 0.931, no: 0.069 },
        {
          question: 'Which team?',
          kind: 'pick-one',
          answer: 'technical',
          confidence: 0.81,
          probabilities: { billing: 0.05, technical: 0.9, sales: 0.05 },
        },
        {
          question: 'How severe?',
          kind: 'score',
          score: 2.6,
          nearest: 'critical',
          confidence: 0.5,
          probabilities: { none: 0.01, minor: 0.04, major: 0.3, critical: 0.65 },
        },
      ],
    });
  });

  it.each([
    [{ questions: QUESTIONS }],
    [{ text: '   ', questions: QUESTIONS }],
    [{ text: 'x'.repeat(CHECKLIST_LIMITS.maxTextChars + 1), questions: QUESTIONS }],
    [{ text: 'x' }],
    [{ text: 'x', questions: [] }],
    [{ text: 'x', questions: Array(CHECKLIST_LIMITS.maxQuestions + 1).fill(QUESTIONS[0]) }],
    [{ text: 'x', questions: [{ kind: 'essay', question: 'Why?' }] }],
    [{ text: 'x', questions: [{ kind: 'yes-no', question: 'q'.repeat(201) }] }],
    [{ text: 'x', questions: [{ kind: 'yes-no', question: 'Ok?', options: ['a', 'b'] }] }],
    [{ text: 'x', questions: [{ kind: 'pick-one', question: 'Which?', options: ['a'] }] }],
    [{ text: 'x', questions: [{ kind: 'pick-one', question: 'Which?', options: ['a', 'A'] }] }],
    [
      {
        text: 'x',
        questions: [
          {
            kind: 'score',
            question: 'How?',
            options: Array(11)
              .fill(0)
              .map((_, i) => `l${i}`),
          },
        ],
      },
    ],
    [
      {
        text: 'x',
        questions: [{ kind: 'pick-one', question: 'Which?', options: ['a', 'b'.repeat(41)] }],
      },
    ],
    [{ text: 'x', questions: [{ kind: 'pick-one', question: 'Which?', options: ['a', 2] }] }],
  ])('rejects invalid input %j before any provider call', (input) => {
    const { env, run } = aiEnv(CLEF_RESPONSE);
    expect(() => prepareChecklist(input as Record<string, unknown>, env)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('throws on malformed model answers so the run is refunded', () => {
    const qs = readChecklistInput({ text: 'x', questions: QUESTIONS }).questions;
    expect(() => mapClefAnswers({}, qs)).toThrow(/no answers/);
    expect(() => mapClefAnswers({ answers: { q1: CLEF_RESPONSE.answers.q1 } }, qs)).toThrow(
      /skipped/,
    );
    expect(() =>
      mapClefAnswers(
        { answers: { ...CLEF_RESPONSE.answers, q1: { type: 'noul', noul: 1.5 } } },
        qs,
      ),
    ).toThrow(/invalid probability/);
    expect(() =>
      mapClefAnswers(
        {
          answers: {
            ...CLEF_RESPONSE.answers,
            q2: { ...CLEF_RESPONSE.answers.q2, choice: 'legal' },
          },
        },
        qs,
      ),
    ).toThrow(/unknown option/);
    expect(() =>
      mapClefAnswers(
        { answers: { ...CLEF_RESPONSE.answers, q3: { ...CLEF_RESPONSE.answers.q3, score: 9 } } },
        qs,
      ),
    ).toThrow(/invalid score/);
  });

  it('keeps the largest allowed request inside the clef-flash context at 1 token per character', () => {
    expect(checklistMaxInputTokens()).toBeLessThanOrEqual(CLEF_FLASH_CONTEXT_TOKENS);
  });

  it('bills at most the full context window once', () => {
    expect(checklistWorstCaseUsd()).toBeCloseTo((CLEF_FLASH_CONTEXT_TOKENS * 0.038) / 1e6, 9);
  });

  it('matches the client-side caps in @wyreup/core', () => {
    expect(CHECKLIST_CLIENT_LIMITS).toEqual(CHECKLIST_LIMITS);
  });
});
