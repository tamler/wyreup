import { describe, expect, it } from 'vitest';
import { prepareGrammarEdits } from './grammar-edits';

const INVALID_EDITS = 'Grammar model returned invalid edits';
const verticalBreaks = [
  ['CR', '\r'],
  ['LF', '\n'],
  ['VT', '\v'],
  ['FF', '\f'],
  ['NEL', '\u0085'],
  ['LS', '\u2028'],
  ['PS', '\u2029'],
];

describe('grammar edits', () => {
  it('preserves all original text for an empty edit list', () => {
    const source = '\uFEFF  Cafe\u0301 👩‍💻\r\n漢字\t \r\n';
    expect(prepareGrammarEdits(source)(' \t\r\n[]\n ')).toBe(source);
  });

  it('preserves Unicode, BOM, CRLF, and spacing outside of edits', () => {
    const source = '\uFEFF  Cafe\u0301 👩‍💻\r\n漢字 is teh best.\t \r\n';
    const answer = JSON.stringify([['漢字 is ', 'teh', ' best.', 'the']]);
    expect(prepareGrammarEdits(source)(answer)).toBe('\uFEFF  Cafe\u0301 👩‍💻\r\n漢字 is the best.\t \r\n');
  });

  it('uses original anchors to sort out-of-order adjacent edits', () => {
    const answer = JSON.stringify([['a', 'b', 'c', 'B'], ['', 'a', 'b', 'A']]);
    expect(prepareGrammarEdits('abc')(answer)).toBe('ABc');
  });

  it('deletes punctuation and copies replacement characters literally', () => {
    const answer = JSON.stringify([['old', '!', ' end', ''], ['start ', 'old', '!', "new $& $1 $$ $` $'"]]);
    expect(prepareGrammarEdits('start old! end')(answer)).toBe("start new $& $1 $$ $` $' end");
  });

  it('allows empty replacement for punctuation and horizontal whitespace', () => {
    const answer = JSON.stringify([['a', '\t\u00A0!', 'b', '']]);
    expect(prepareGrammarEdits('a\t\u00A0!b')(answer)).toBe('ab');
  });

  it.each([['a currency symbol', '€'], ['an emoji', '🙂'], ['a format character', '\u200B']])(
    'rejects empty replacement for %s',
    (_name, old) => {
      expect(() => prepareGrammarEdits(`a${old}b`)(JSON.stringify([['a', old, 'b', '']]))).toThrow(INVALID_EDITS);
    },
  );

  it.each(verticalBreaks)('rejects removal and insertion of %s line breaks', (_name, lineBreak) => {
    const removal = JSON.stringify([['', `old${lineBreak}`, ' end.', 'new']]);
    expect(() => prepareGrammarEdits(`old${lineBreak} end.`)(removal)).toThrow(INVALID_EDITS);
    const insertion = JSON.stringify([['', 'old', ' end.', `new${lineBreak}`]]);
    expect(() => prepareGrammarEdits('old end.')(insertion)).toThrow(INVALID_EDITS);
  });

  it('preserves vertical breaks in anchors and no-op output', () => {
    const prefix = verticalBreaks.map(([, lineBreak]) => lineBreak).join('');
    const source = prefix + 'old end.';
    const edit = JSON.stringify([[prefix, 'old', ' end.', 'new']]);
    expect(prepareGrammarEdits(source)(edit)).toBe(prefix + 'new end.');
    expect(prepareGrammarEdits(source)('[]')).toBe(source);
  });

  it.each([
    ['overlapping anchor occurrences', 'aaaa', [['a', 'a', 'a', 'b']]],
    ['anchor is absent', 'One two.', [['One ', 'three', '.', 'four']]],
    ['anchor exists only after a prior edit', 'They went store.', [
      ['They ', 'went store', '.', 'went to the store'],
      ['went to the ', 'store', '.', 'shop'],
    ]],
    ['duplicate range', 'abc', [['a', 'b', 'c', 'B'], ['a', 'b', '', 'd']]],
    ['overlapping ranges', 'abc', [['', 'ab', 'c', 'AB'], ['a', 'bc', '', 'BC']]],
    ['valid edit followed by an invalid edit', 'abc', [['a', 'b', 'c', 'B'], ['z', 'c', '', 'C']]],
    ['both contexts are empty', 'abc', [['', 'abc', '', 'ABC']]],
    ['old is empty', 'abc', [['a', '', 'bc', 'B']]],
    ['lexical text removed', 'Start. A sentence to keep. End.', [['Start. ', 'A sentence to keep.', ' End.', '']]],
    ['lexical span replaced with symbols', 'Start. 字₁. End.', [['Start. ', '字₁.', ' End.', ' 💸']]],
    ['CR removed', 'Old\rtext', [['', 'Old\r', 'text', 'New']]],
    ['LF introduced', 'Old text', [['', 'Old ', 'text', 'New\n']]],
    ['new join merges CR and LF', '\r!\n', [['\r', '!', '\n', '']]],
    ['source start inside a combining sequence', 'e\u0301!', [['e', '\u0301', '!', '.']]],
    ['source end inside a combining sequence', 'e\u0301!', [['', 'e', '\u0301!', 'a']]],
    ['source end inside a joined emoji', '👩‍💻x', [['', '👩', '‍💻x', '!']]],
    ['left join attaches a combining mark to untouched text', 'ab!', [['a', 'b', '!', '\u0301b']]],
    ['left join attaches a ZWJ sequence to untouched text', '👩x!', [['👩', 'x', '!', '\u200D💻x']]],
    ['right join attaches a ZWJ sequence to untouched text', 'x💻!', [['', 'x', '💻!', 'x👩\u200D']]],
    ['ill-formed replacement', 'a!', [['', 'a', '!', 'b\uDFFF']]],
  ])('rejects %s', (_name, source, edits) => {
    expect(() => prepareGrammarEdits(source)(JSON.stringify(edits))).toThrow(INVALID_EDITS);
  });

  it.each([
    '',
    '[] text',
    '```json\n[]\n```',
    '\u00A0[]',
    '\uFEFF[]',
    '{"edits":[]}',
    '[null]',
    '[["", "old", "!"]]',
    '[["", "old", "!", "new", "extra"]]',
    '[["", "old", "!", 42]]',
    JSON.stringify(Array.from({ length: 65 }, () => ['', 'old', '!', 'new'])),
    ' '.repeat(64 * 1024 - 1) + '[]',
  ])('rejects malformed or oversized JSON at case %#', answer => {
    expect(() => prepareGrammarEdits('old!')(answer)).toThrow(INVALID_EDITS);
  });

  it('rejects isolated UTF-16 surrogates in the source', () => {
    expect(() => prepareGrammarEdits('\uD800invalid')).toThrow('Grammar input must be well-formed Unicode.');
    expect(() => prepareGrammarEdits('invalid\uDC00')).toThrow('Grammar input must be well-formed Unicode.');
  });

  it('counts scalar limits independently of UTF-16 units', () => {
    const left = '🧑'.repeat(120);
    const old = '字'.repeat(120);
    const right = '🌍'.repeat(120);
    const replacement = 'a' + '🧑'.repeat(159);
    expect(prepareGrammarEdits(left + old + right)(JSON.stringify([[left, old, right, replacement]])))
      .toBe(left + replacement + right);
    for (const [tooLongLeft, tooLongOld, tooLongRight, tooLongReplacement] of [
      [left + '🧑', old, right, replacement],
      [left, old + '字', right, replacement],
      [left, old, right + '🌍', replacement],
      [left, old, right, replacement + '🧑'],
    ]) {
      const source = tooLongLeft + tooLongOld + tooLongRight;
      const answer = JSON.stringify([[tooLongLeft, tooLongOld, tooLongRight, tooLongReplacement]]);
      expect(() => prepareGrammarEdits(source)(answer)).toThrow(INVALID_EDITS);
    }
  });

  it('accepts a response with exactly 64 KiB of UTF-16 units', () => {
    const answer = ' '.repeat(64 * 1024 - 2) + '[]';
    expect(prepareGrammarEdits('old!')(answer)).toBe('old!');
  });

  it('enforces the reconstructed UTF-8 output limit', () => {
    const labels = Array.from({ length: 25 }, (_, index) => `line-${index}: `);
    const body = labels.map(label => label + 'x\n').join('');
    const source = ' '.repeat(484 - body.length) + body;
    const replacement = 'a' + '🧑'.repeat(159);
    const answer = JSON.stringify(labels.map(label => [label, 'x', '\n', replacement]));
    const corrected = prepareGrammarEdits(source)(answer);
    expect(new TextEncoder().encode(corrected)).toHaveLength(16 * 1024);
    expect(() => prepareGrammarEdits(source + '!')(answer)).toThrow(INVALID_EDITS);
  });
});
