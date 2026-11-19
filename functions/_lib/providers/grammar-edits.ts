const MAX_RESPONSE_UNITS = 64 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_EDITS = 64;
const MAX_CONTEXT_SCALARS = 120;
const MAX_OLD_SCALARS = 120;
const MAX_REPLACEMENT_SCALARS = 160;
const LONE_SURROGATE = /\p{Surrogate}/u;
const LEXICAL = /[\p{Letter}\p{Number}]/u;
const LINE_BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const NON_DELETABLE = /[^\p{Punctuation}\p{Space_Separator}\t]/u;

export const GRAMMAR_EDIT_PROMPT = [
  'You are a copy editor. Fix only genuine grammar, spelling, and punctuation errors.',
  'Preserve the author’s voice and meaning. Preserve every sentence and paragraph, intentional repetitions, and their original order.',
  'Return only a JSON array of edits. Each edit is [leftContext, old, rightContext, replacement], all strings.',
  'Copy the first three strings exactly from the original source so that their concatenation occurs exactly once.',
  'Use at least one nonempty context. Make each edit local and keep the original edit spans disjoint.',
  'Use at most 64 edits, 120 Unicode characters in each context, 1–120 in old, and 0–160 in replacement.',
  'Line and paragraph breaks are allowed in context only. Keep CR, LF, VT, FF, NEL, LS, and PS out of old and replacement.',
  'If old contains a letter or number, replacement must also contain a letter or number.',
  'An empty replacement is allowed only when each character in old is punctuation or horizontal whitespace.',
  'Include every necessary edit and return [] if no edits are needed.',
].join(' ');

type Edit = { start: number; end: number; replacement: string };

function invalidEdits(): never {
  throw new Error('Grammar model returned invalid edits');
}

function graphemeBoundaries(source: string): Set<number> {
  const boundaries = new Set([source.length]);
  for (const { index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)) {
    boundaries.add(index);
  }
  return boundaries;
}

export function validateGrammarSource(source: string): void {
  if (LONE_SURROGATE.test(source)) throw new Error('Grammar input must be well-formed Unicode.');
}

export function prepareGrammarEdits(source: string): (answer: string) => string {
  validateGrammarSource(source);
  return answer => applyGrammarEdits(source, answer);
}

function applyGrammarEdits(source: string, answer: string): string {
  if (answer.length > MAX_RESPONSE_UNITS) invalidEdits();
  let rawEdits: unknown;
  try {
    rawEdits = JSON.parse(answer);
  } catch {
    invalidEdits();
  }
  if (!Array.isArray(rawEdits) || rawEdits.length > MAX_EDITS) invalidEdits();
  if (rawEdits.length === 0) return source;

  const sourceBoundaries = graphemeBoundaries(source);
  const edits: Edit[] = [];
  for (const tuple of rawEdits) {
    if (!Array.isArray(tuple) || tuple.length !== 4 ||
        !tuple.every((value): value is string => typeof value === 'string' && !LONE_SURROGATE.test(value))) {
      invalidEdits();
    }

    const [left, old, right, replacement] = tuple;
    if ((!left && !right) || !old ||
        [...left].length > MAX_CONTEXT_SCALARS || [...right].length > MAX_CONTEXT_SCALARS ||
        [...old].length > MAX_OLD_SCALARS || [...replacement].length > MAX_REPLACEMENT_SCALARS ||
        LINE_BREAK.test(old) || LINE_BREAK.test(replacement) ||
        (!replacement && NON_DELETABLE.test(old)) ||
        (LEXICAL.test(old) && !LEXICAL.test(replacement))) {
      invalidEdits();
    }

    const anchor = left + old + right;
    const offset = source.indexOf(anchor);
    // Advance by one code unit to catch overlapping anchor occurrences.
    if (offset === -1 || source.indexOf(anchor, offset + 1) !== -1) invalidEdits();

    const start = offset + left.length;
    const end = start + old.length;
    if (!sourceBoundaries.has(start) || !sourceBoundaries.has(end)) invalidEdits();
    edits.push({ start, end, replacement });
  }

  edits.sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const edit of edits) {
    if (edit.start < previousEnd) invalidEdits();
    previousEnd = edit.end;
  }

  let corrected = '';
  let cursor = 0;
  const joins: number[] = [];
  for (const { start, end, replacement } of edits) {
    corrected += source.slice(cursor, start);
    joins.push(corrected.length);
    corrected += replacement;
    joins.push(corrected.length);
    cursor = end;
  }
  corrected += source.slice(cursor);

  if (new TextEncoder().encode(corrected).length > MAX_OUTPUT_BYTES) invalidEdits();
  const correctedBoundaries = graphemeBoundaries(corrected);
  if (joins.some(index => !correctedBoundaries.has(index))) invalidEdits();
  return corrected;
}
