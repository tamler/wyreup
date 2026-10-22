import type { ToolModule, ToolRunContext } from '../../types.js';

export interface RegexFromTextParams {
  /** Natural-language description of what to match. Required. */
  description?: string;
  /** Optional flag override. If unset, derived from description + pattern default. */
  flags?: string;
}

export const defaultRegexFromTextParams: RegexFromTextParams = {
  description: '',
  flags: '',
};

export const regexFromText: ToolModule<RegexFromTextParams> = {
  id: 'regex-from-text',
  slug: 'regex-from-text',
  name: 'Regex From Text',
  description:
    'Generate a regex pattern from a natural-language description. Heuristic engine covers ~30 common patterns (emails, URLs, phone numbers, dates, UUIDs, hex colors, etc.). Output chains into regex-tester and regex-visualize.',
  llmDescription:
    'Convert a plain-English request like "find email addresses" or "match ISO dates" into a JavaScript regex. Returns JSON with pattern, flags, explanation, and confidence. For unknown phrasings, falls back to a low-confidence guess with an explicit no-match signal — call the AI variant or revise the description.',
  category: 'inspect',
  keywords: [
    'regex',
    'regexp',
    'natural language',
    'pattern',
    'generate',
    'ai-assisted',
    'from text',
  ],

  input: {
    accept: ['text/plain'],
    min: 0,
    max: 1,
    sizeLimit: 8 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultRegexFromTextParams,

  paramSchema: {
    description: {
      type: 'string',
      label: 'description',
      help: 'Plain English: "match email addresses", "find ISO dates case insensitive", "extract hex colors".',
      placeholder: 'match email addresses',
      multiline: true,
    },
    flags: {
      type: 'string',
      label: 'flags (optional override)',
      placeholder: 'g',
      maxLength: 6,
      help: 'If set, overrides flags inferred from the description.',
    },
  },

  async run(inputs: File[], params: RegexFromTextParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');
    let description = params.description ?? '';
    if (!description.trim() && inputs.length === 1) {
      description = (await inputs[0]!.text()).trim();
      if (ctx.signal.aborted) throw new Error('Aborted');
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Matching heuristics' });
    if (ctx.signal.aborted) throw new Error('Aborted');
    const { generateRegexFromText } = await import('./generate.js');
    if (ctx.signal.aborted) throw new Error('Aborted');
    const result = generateRegexFromText(description, params.flags);
    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  seoContent: {
    intro:
      'Describe what you want to match in plain English and get a working regular expression back. Type "find email addresses" or "extract phone numbers" and the heuristic engine recognises the request from a library of ~30 common patterns. The result is ready to paste into JavaScript, Python, grep, your editor — anywhere standard regex syntax works. Nothing leaves your browser.',
    useCases: [
      'Generate a regex without remembering the syntax — type the description, paste the result.',
      'Bootstrap a pattern when you know the target (URLs, dates, UUIDs) but not the exact characters.',
      'Teach regex by example — see how "match hex colors" becomes `#[0-9a-fA-F]{3,8}\\b`.',
      'Quickly draft search-and-replace patterns for editor find dialogs.',
      'Compose into chains: from-text → visualize (see the diagram) → tester (try it on real input).',
    ],
    faq: [
      {
        q: 'Does this use AI?',
        a: 'No — the free version is a curated heuristic engine covering ~30 common patterns (emails, URLs, phones, dates, UUIDs, hex colors, IPv4/6, credit cards, SSNs, ZIPs, hashtags, semver, prices, timestamps, comments, file paths, emoji, more). It runs instantly, in your browser, with zero requests to any server.',
      },
      {
        q: 'What happens when my description does not match a known pattern?',
        a: 'The tool returns `confidence: "no-match"` along with an `upgrade` field pointing to the future AI fallback. You either revise the description or wait for the hosted-AI Pro tier.',
      },
      {
        q: 'Can I detect flags from natural language?',
        a: 'Yes — "case insensitive", "multiline", "first match only", "every match", "ignore case", "unicode" are all recognised and applied to the output flags.',
      },
      {
        q: 'Does the output work in every regex flavour?',
        a: 'The patterns use JavaScript regex syntax. The vast majority work as-is in Python (re), grep -E / -P, ripgrep, sed, and editor find dialogs. Lookbehind and named-group syntax can vary — visualize the result to spot anything flavour-specific.',
      },
    ],
    alsoTry: [
      { id: 'regex-tester', why: 'Run the generated regex against real input to verify matches.' },
      { id: 'regex-visualize', why: 'See the regex as a railroad-style SVG diagram.' },
      { id: 'regex-explain', why: 'Get a plain-English breakdown of every part of the regex.' },
    ],
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
