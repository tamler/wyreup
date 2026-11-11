// Parses the checklist text a user types into structured questions.
//
// One question per line:
//   Is this email urgent?                              yes/no
//   Which team should handle it? [billing | tech | sales]   pick one
//   How severe is it? [score: none | minor | major]    score, lowest level first
//
// Blank lines and lines starting with # are ignored. The server re-validates
// everything; these caps must match CHECKLIST_LIMITS in
// functions/_lib/providers/checklist-models.ts (a test checks this).

export const CHECKLIST_CLIENT_LIMITS = {
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
  options?: string[];
}

const BRACKET = /^(.*?)\s*\[([^\]]*)\]\s*$/;

export function parseChecklist(source: string): ChecklistQuestion[] {
  const L = CHECKLIST_CLIENT_LIMITS;
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) throw new Error('Write at least one question, one per line.');
  if (lines.length > L.maxQuestions)
    throw new Error(`At most ${L.maxQuestions} questions per run. You wrote ${lines.length}.`);

  return lines.map((line, i) => {
    const n = i + 1;
    const m = BRACKET.exec(line);
    let kind: ChecklistKind = 'yes-no';
    let question = line;
    let options: string[] | undefined;
    if (m) {
      question = m[1]!.trim();
      let inner = m[2]!.trim();
      const score = /^score\s*:/i.exec(inner);
      if (score) inner = inner.slice(score[0].length);
      kind = score ? 'score' : 'pick-one';
      options = inner
        .split('|')
        .map((o) => o.trim())
        .filter(Boolean);
      if (options.length < L.minOptions || options.length > L.maxOptions)
        throw new Error(
          `Question ${n}: list ${L.minOptions} to ${L.maxOptions} options inside [ ], separated by |.`,
        );
      const seen = new Set<string>();
      for (const o of options) {
        if (o.length > L.maxOptionChars)
          throw new Error(
            `Question ${n}: each option can be up to ${L.maxOptionChars} characters.`,
          );
        if (seen.has(o.toLowerCase()))
          throw new Error(`Question ${n}: the option "${o}" appears twice.`);
        seen.add(o.toLowerCase());
      }
    }
    if (!question) throw new Error(`Question ${n} has options but no question.`);
    if (question.length > L.maxQuestionChars)
      throw new Error(`Question ${n} is longer than ${L.maxQuestionChars} characters.`);
    return options ? { kind, question, options } : { kind, question };
  });
}
