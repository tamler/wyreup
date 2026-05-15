import type { ToolModule, ToolRunContext } from '../../types.js';
import { PATTERNS } from '../regex-from-text/patterns.js';

export interface RegexExplainParams {
  pattern?: string;
}

export const defaultRegexExplainParams: RegexExplainParams = {
  pattern: '',
};

export interface RegexExplainNode {
  pattern: string;
  meaning: string;
  kind:
    | 'literal'
    | 'class'
    | 'group'
    | 'assertion'
    | 'quantifier'
    | 'alternation'
    | 'backreference'
    | 'special';
}

export interface RegexExplainResult {
  pattern: string;
  flags: string;
  summary: string;
  breakdown: RegexExplainNode[];
  recognisedAs?: string;
}

interface AstNode {
  type: string;
  [k: string]: unknown;
}

function parsePatternAndFlags(raw: string): { body: string; flags: string } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\/(.+)\/([gimsuy]*)$/s);
  if (m) return { body: m[1]!, flags: m[2]! };
  return { body: trimmed, flags: '' };
}

function charMeaning(node: AstNode): string {
  const value = node.value as string;
  const kind = node.kind as string;
  if (kind === 'meta') {
    switch (value) {
      case '\\d': return 'any digit (0-9)';
      case '\\D': return 'any character that is not a digit';
      case '\\w': return 'any word character (a-z, A-Z, 0-9, _)';
      case '\\W': return 'any character that is not a word character';
      case '\\s': return 'any whitespace character';
      case '\\S': return 'any non-whitespace character';
      case '\\b': return 'a word boundary';
      case '\\B': return 'a non-word-boundary position';
      case '\\n': return 'a newline';
      case '\\r': return 'a carriage return';
      case '\\t': return 'a tab character';
      case '.': return 'any single character except newline';
      default: return `the meta character ${value}`;
    }
  }
  if (kind === 'control') return `the control character ${value}`;
  if (kind === 'hex' || kind === 'unicode' || kind === 'oct') return `the character ${value}`;
  if (value === ' ') return 'a space';
  return `the literal "${value}"`;
}

function characterClassMeaning(node: AstNode): string {
  const negative = Boolean(node.negative);
  const expressions = (node.expressions ?? []) as AstNode[];
  const parts: string[] = [];
  for (const e of expressions) {
    if (e.type === 'ClassRange') {
      const fromVal = (e.from as AstNode | undefined)?.value;
      const toVal = (e.to as AstNode | undefined)?.value;
      const from = typeof fromVal === 'string' || typeof fromVal === 'number' ? String(fromVal) : '';
      const to = typeof toVal === 'string' || typeof toVal === 'number' ? String(toVal) : '';
      parts.push(`${from}-${to}`);
    } else if (e.type === 'Char') {
      parts.push(typeof e.value === 'string' || typeof e.value === 'number' ? String(e.value) : '');
    } else {
      parts.push(e.type);
    }
  }
  const set = parts.join(', ');
  return negative
    ? `any character NOT in: ${set}`
    : `any character in: ${set}`;
}

function quantifierMeaning(q: AstNode): string {
  const kind = q.kind as string;
  const greedy = q.greedy !== false;
  const suffix = greedy ? '' : ' (lazy)';
  if (kind === '+') return `one or more times${suffix}`;
  if (kind === '*') return `zero or more times${suffix}`;
  if (kind === '?') return `optionally (zero or one)${suffix}`;
  if (kind === 'Range') {
    const from = q.from as number;
    const to = q.to as number | undefined;
    if (to === undefined) return `${from} or more times${suffix}`;
    if (from === to) return `exactly ${from} times${suffix}`;
    return `between ${from} and ${to} times${suffix}`;
  }
  return 'a quantifier';
}

function assertionMeaning(node: AstNode): string {
  const kind = node.kind as string;
  const negative = Boolean(node.negative);
  if (kind === '^') return 'at the start of the input (or line in multiline mode)';
  if (kind === '$') return 'at the end of the input (or line in multiline mode)';
  if (kind === '\\b') return 'at a word boundary';
  if (kind === '\\B') return 'NOT at a word boundary';
  if (kind === 'Lookahead') return negative ? 'NOT followed by the inner pattern' : 'followed by the inner pattern';
  if (kind === 'Lookbehind') return negative ? 'NOT preceded by the inner pattern' : 'preceded by the inner pattern';
  return kind;
}

function rawOf(node: AstNode): string {
  const loc = node.loc as { source?: string } | undefined;
  if (loc && typeof loc.source === 'string') return loc.source;
  return node.type;
}

function explainNode(node: AstNode): RegexExplainNode[] {
  const out: RegexExplainNode[] = [];
  if (node.type === 'Char') {
    out.push({ pattern: rawOf(node), meaning: charMeaning(node), kind: 'literal' });
  } else if (node.type === 'CharacterClass') {
    out.push({ pattern: rawOf(node), meaning: characterClassMeaning(node), kind: 'class' });
  } else if (node.type === 'Assertion') {
    out.push({ pattern: rawOf(node), meaning: assertionMeaning(node), kind: 'assertion' });
    // Lookarounds carry an inner expression.
    const inner = node.assertion as AstNode | undefined;
    if (inner) out.push(...explainNode(inner));
  } else if (node.type === 'Group') {
    const capturing = node.capturing !== false;
    const name = node.name as string | undefined;
    if (capturing) {
      const num = typeof node.number === 'number' ? String(node.number) : '';
      const label = name ? `named group "${name}"` : `group ${num}`.trim();
      out.push({
        pattern: rawOf(node),
        meaning: `start of ${label} — captures what follows`,
        kind: 'group',
      });
    } else {
      out.push({ pattern: rawOf(node), meaning: 'non-capturing group — groups without capturing', kind: 'group' });
    }
    const inner = node.expression as AstNode | undefined;
    if (inner) out.push(...explainNode(inner));
  } else if (node.type === 'Alternative') {
    const exprs = (node.expressions ?? []) as AstNode[];
    for (const e of exprs) out.push(...explainNode(e));
  } else if (node.type === 'Disjunction') {
    const left = node.left as AstNode | undefined;
    const right = node.right as AstNode | undefined;
    out.push({ pattern: rawOf(node), meaning: 'either the left alternative OR the right alternative', kind: 'alternation' });
    if (left) out.push(...explainNode(left));
    if (right) out.push(...explainNode(right));
  } else if (node.type === 'Repetition') {
    const inner = node.expression as AstNode;
    const q = node.quantifier as AstNode;
    const innerNodes = explainNode(inner);
    if (innerNodes.length > 0) {
      const last = innerNodes[innerNodes.length - 1]!;
      out.push({
        pattern: rawOf(node),
        meaning: `${last.meaning} — repeated ${quantifierMeaning(q)}`,
        kind: 'quantifier',
      });
      // Push any prior pieces from the inner explanation too (e.g. groups).
      out.push(...innerNodes.slice(0, -1));
    }
  } else if (node.type === 'Backreference') {
    const ref =
      typeof node.reference === 'number' || typeof node.reference === 'string'
        ? String(node.reference)
        : '';
    out.push({
      pattern: rawOf(node),
      meaning: `same text as previously captured by group ${ref}`.trim(),
      kind: 'backreference',
    });
  } else {
    out.push({ pattern: rawOf(node), meaning: node.type, kind: 'special' });
  }
  return out;
}

function recognise(body: string): string | undefined {
  for (const p of PATTERNS) {
    if (p.pattern === body || `/${p.pattern}/` === body) {
      return p.explanation;
    }
  }
  return undefined;
}

export function explainRegex(rawPattern: string): RegexExplainResult {
  const input = (rawPattern ?? '').trim();
  if (!input) throw new Error('regex-explain requires a non-empty "pattern" parameter.');
  const { body, flags } = parsePatternAndFlags(input);

  let ast: AstNode;
  try {
    // regexp-tree is CJS; match regex-visualize's loading pattern.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tree = require('regexp-tree') as { parse: (s: string) => AstNode };
    ast = tree.parse(`/${body}/${flags}`);
  } catch (e) {
    throw new Error(`Could not parse regex: ${(e as Error).message}`);
  }

  const body_ = ast.body as AstNode;
  const breakdown = body_ ? explainNode(body_) : [];

  const recognised = recognise(body);
  const flagNotes: string[] = [];
  if (flags.includes('g')) flagNotes.push('matches globally (all occurrences)');
  if (flags.includes('i')) flagNotes.push('case-insensitive');
  if (flags.includes('m')) flagNotes.push('multiline (^ and $ match per line)');
  if (flags.includes('s')) flagNotes.push('dotall (. matches newlines)');
  if (flags.includes('u')) flagNotes.push('unicode mode');
  if (flags.includes('y')) flagNotes.push('sticky (anchored to lastIndex)');

  let summary = recognised
    ? `Recognised pattern: ${recognised}.`
    : `A ${breakdown.length}-part regular expression.`;
  if (flagNotes.length > 0) summary += ` Flags: ${flagNotes.join('; ')}.`;

  return {
    pattern: body,
    flags,
    summary,
    breakdown,
    ...(recognised ? { recognisedAs: recognised } : {}),
  };
}

export const regexExplain: ToolModule<RegexExplainParams> = {
  id: 'regex-explain',
  slug: 'regex-explain',
  name: 'Regex Explain',
  description:
    'Translate a regular expression into plain English. Walks the AST and emits a per-part breakdown — what each char-class, group, quantifier, assertion, and alternation actually means. Recognises ~30 common patterns by shape (emails, URLs, UUIDs, etc.). Chains after regex-tester and regex-visualize for the "what does this thing actually do?" hand-off.',
  llmDescription:
    'Take a JavaScript regex (with or without /.../flags), return JSON with a summary, recognised-pattern hint if known, and an ordered breakdown — one entry per AST node with the source fragment, a plain-English meaning, and a kind tag (literal / class / group / assertion / quantifier / alternation / backreference / special).',
  category: 'inspect',
  keywords: ['regex', 'regexp', 'explain', 'breakdown', 'annotate', 'pattern', 'translate'],

  input: {
    accept: ['text/plain'],
    min: 0,
    max: 1,
    sizeLimit: 64 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultRegexExplainParams,

  paramSchema: {
    pattern: {
      type: 'string',
      label: 'regex pattern',
      help: 'Accepts /pattern/flags or a bare pattern. Required.',
      placeholder: '/^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$/',
      multiline: true,
    },
  },

  async run(inputs: File[], params: RegexExplainParams, ctx: ToolRunContext): Promise<Blob[]> {
    let pattern = params.pattern ?? '';
    if (!pattern.trim() && inputs.length === 1) {
      pattern = (await inputs[0]!.text()).trim();
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing regex' });
    const result = explainRegex(pattern);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
