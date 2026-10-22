import type { ToolModule, ToolRunContext } from '../../types.js';

export interface RegexExplainParams {
  pattern?: string;
}

export const defaultRegexExplainParams: RegexExplainParams = {
  pattern: '',
};

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
    if (ctx.signal.aborted) throw new Error('Aborted');
    let pattern = params.pattern ?? '';
    if (!pattern.trim() && inputs.length === 1) {
      pattern = (await inputs[0]!.text()).trim();
      if (ctx.signal.aborted) throw new Error('Aborted');
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing regex' });
    if (ctx.signal.aborted) throw new Error('Aborted');
    const { explainRegex } = await import('./explain.js');
    if (ctx.signal.aborted) throw new Error('Aborted');
    const result = explainRegex(pattern);
    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  seoContent: {
    intro:
      'Paste a regex — with or without `/.../flags` delimiters — and get a plain-English breakdown of what every part does. The tool parses the regex into its AST and walks each node: character classes, groups, quantifiers, assertions, alternation, backreferences, every flag. Recognises ~30 common patterns by shape and tells you when your regex is "an email matcher" or "a UUID pattern". Helpful for code review, learning, or auditing a regex from someone else.',
    useCases: [
      'Decode an unfamiliar regex pulled from a Stack Overflow answer.',
      'Verify a regex you wrote does what you think it does — read the English, not the symbols.',
      'Teach regex by example — paste any pattern, see the structure.',
      'Audit production regexes for accidental behaviour (greedy quantifiers, missing anchors, unintended backtracking).',
      'Compose into chains: tester → visualize → explain — three views of the same regex.',
    ],
    faq: [
      {
        q: 'Does it accept patterns from other languages (Python, PCRE, .NET)?',
        a: 'The parser targets JavaScript regex syntax. Most patterns work as-is, but a few constructs vary: PCRE-only features like `\\K` and atomic groups are unrecognised, .NET-style balanced groups are not supported. For mainstream patterns (anchors, char classes, quantifiers, captures, alternation, lookarounds) the breakdown is correct across flavours.',
      },
      {
        q: 'What does "Recognised pattern" mean?',
        a: 'The tool keeps a curated table of common patterns (emails, URLs, UUIDs, IPv4/6, ISO dates, hex colors, etc.). When your input matches one of these exactly, the summary names it ("Recognised pattern: Email addresses.") so you don\'t have to puzzle through the breakdown to know what it does.',
      },
      {
        q: 'Does it explain flags?',
        a: 'Yes — the summary lists active flags and what they do: `g` (global), `i` (case-insensitive), `m` (multiline), `s` (dotall), `u` (unicode), `y` (sticky).',
      },
    ],
    alsoTry: [
      {
        id: 'regex-tester',
        why: 'Test the regex against sample text to see actual matches and groups.',
      },
      { id: 'regex-visualize', why: 'See the regex as a railroad-style SVG diagram.' },
      {
        id: 'regex-from-text',
        why: 'Go the other way — describe what you want in English, get a regex.',
      },
    ],
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
