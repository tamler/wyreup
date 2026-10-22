import { PATTERNS, FLAG_MODIFIERS, type PatternEntry } from './patterns.js';

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

export function generateRegexFromText(
  description: string,
  paramFlags?: string,
): RegexFromTextResult {
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
  const flags =
    paramFlags && paramFlags.length > 0 ? paramFlags : applyFlagModifiers(baseFlags, lower);

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

