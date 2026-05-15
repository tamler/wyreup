import type { ToolModule, ToolRunContext } from '../../types.js';
import { PATTERNS, FLAG_MODIFIERS, type PatternEntry } from './patterns.js';

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

export interface RegexFromTextResult {
  description: string;
  pattern: string;
  flags: string;
  fullRegex: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low' | 'no-match';
  matchedKeywords: string[];
  alternatives?: { pattern: string; flags: string; explanation: string }[];
  /** Note for callers: when no pattern matched, suggest the Pro AI variant. */
  upgrade?: string;
}

interface Hit {
  entry: PatternEntry;
  keyword: string;
}

function findHits(lower: string): Hit[] {
  const hits: Hit[] = [];
  for (const entry of PATTERNS) {
    // Find the longest keyword from this entry that appears in the input.
    let best: string | null = null;
    for (const k of entry.keywords) {
      if (lower.includes(k) && (!best || k.length > best.length)) best = k;
    }
    if (best) hits.push({ entry, keyword: best });
  }
  // Sort: longer keyword wins, then higher-confidence, then earlier-defined.
  hits.sort((a, b) => {
    if (b.keyword.length !== a.keyword.length) return b.keyword.length - a.keyword.length;
    const order = { high: 0, medium: 1, low: 2 } as const;
    return order[a.entry.confidence] - order[b.entry.confidence];
  });
  return hits;
}

function applyFlagModifiers(base: string, lower: string): string {
  const flags = new Set(base);
  for (const mod of FLAG_MODIFIERS) {
    const hit = mod.phrases.some((p) => lower.includes(p));
    if (!hit) continue;
    if (mod.add) for (const c of mod.add) flags.add(c);
    if (mod.remove) for (const c of mod.remove) flags.delete(c);
  }
  // Stable flag order matches V8 conventions.
  const order = ['g', 'i', 'm', 's', 'u', 'y'];
  return order.filter((c) => flags.has(c)).join('');
}

/** Render the `/pattern/flags` form. */
function fullRegexOf(pattern: string, flags: string): string {
  return `/${pattern}/${flags}`;
}

export function generateRegexFromText(description: string, paramFlags?: string): RegexFromTextResult {
  const desc = (description ?? '').trim();
  if (!desc) {
    throw new Error('regex-from-text requires a non-empty "description" parameter.');
  }
  const lower = desc.toLowerCase();
  const hits = findHits(lower);

  if (hits.length === 0) {
    return {
      description: desc,
      pattern: '',
      flags: '',
      fullRegex: '',
      explanation:
        'No matching heuristic. The free heuristic engine knows about ~30 common patterns ' +
        '(emails, URLs, phones, dates, UUIDs, hex colors, etc.). For arbitrary descriptions, ' +
        'the Pro AI variant (Groq Llama 70B) handles open-ended cases.',
      confidence: 'no-match',
      matchedKeywords: [],
      upgrade: 'Pro: AI-generated regex for arbitrary descriptions.',
    };
  }

  const primary = hits[0]!;
  const baseFlags = primary.entry.defaultFlags ?? 'g';
  const flags = paramFlags && paramFlags.length > 0 ? paramFlags : applyFlagModifiers(baseFlags, lower);

  const alternatives = hits.slice(1, 4).map((h) => ({
    pattern: h.entry.pattern,
    flags: h.entry.defaultFlags ?? 'g',
    explanation: h.entry.explanation,
  }));

  return {
    description: desc,
    pattern: primary.entry.pattern,
    flags,
    fullRegex: fullRegexOf(primary.entry.pattern, flags),
    explanation: primary.entry.explanation,
    confidence: primary.entry.confidence,
    matchedKeywords: hits.map((h) => h.keyword),
    ...(alternatives.length > 0 ? { alternatives } : {}),
  };
}

export const regexFromText: ToolModule<RegexFromTextParams> = {
  id: 'regex-from-text',
  slug: 'regex-from-text',
  name: 'Regex From Text',
  description:
    'Generate a regex pattern from a natural-language description. Heuristic engine covers ~30 common patterns (emails, URLs, phone numbers, dates, UUIDs, hex colors, etc.). Output chains into regex-tester and regex-visualize.',
  llmDescription:
    'Convert a plain-English request like "find email addresses" or "match ISO dates" into a JavaScript regex. Returns JSON with pattern, flags, explanation, and confidence. For unknown phrasings, falls back to a low-confidence guess with an explicit no-match signal — call the AI variant or revise the description.',
  category: 'inspect',
  keywords: ['regex', 'regexp', 'natural language', 'pattern', 'generate', 'ai-assisted', 'from text'],

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
    let description = params.description ?? '';
    if (!description.trim() && inputs.length === 1) {
      description = (await inputs[0]!.text()).trim();
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Matching heuristics' });
    const result = generateRegexFromText(description, params.flags);
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
