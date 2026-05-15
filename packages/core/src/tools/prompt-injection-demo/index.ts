import type { ToolModule, ToolRunContext } from '../../types.js';
import { analyzeConfusable, type ConfusableHit, type MixedScriptToken } from '../text-confusable/index.js';

export interface PromptInjectionDemoParams {
  /** When true, include the HTML render with <mark> highlights in the result. Default true. */
  includeHtml?: boolean;
}

export const defaultPromptInjectionDemoParams: PromptInjectionDemoParams = {
  includeHtml: true,
};

export interface InjectionHighlight {
  start: number;
  end: number;
  text: string;
  kind: 'invisible' | 'confusable' | 'mixed-script' | 'injection-phrase' | 'control' | 'fence';
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface PromptInjectionDemoResult {
  verdict: 'clean' | 'low' | 'medium' | 'high';
  highlights: InjectionHighlight[];
  html?: string;
  summary: string;
  totals: { chars: number; flagged: number };
}

/**
 * Known prompt-injection phrases. Patterns are case-insensitive, word-bounded
 * where appropriate. Not exhaustive — catches the textbook attacks seen in
 * the wild (jailbreak / instruction-override / context-fence injection).
 */
const INJECTION_PATTERNS: { re: RegExp; kind: InjectionHighlight['kind']; severity: InjectionHighlight['severity']; detail: string }[] = [
  // Instruction-override phrases.
  { re: /\bignore\s+(all\s+)?(the\s+)?previous\s+(instructions?|prompts?|context)\b/gi, kind: 'injection-phrase', severity: 'high', detail: 'Instruction-override phrase' },
  { re: /\bdisregard\s+(all\s+)?(the\s+)?previous\s+(instructions?|prompts?|context)\b/gi, kind: 'injection-phrase', severity: 'high', detail: 'Instruction-override phrase' },
  { re: /\bforget\s+(all\s+)?(the\s+)?previous\s+(instructions?|prompts?|context)\b/gi, kind: 'injection-phrase', severity: 'high', detail: 'Instruction-override phrase' },
  { re: /\boverride\s+(all\s+)?(the\s+)?(instructions?|rules?|safety)\b/gi, kind: 'injection-phrase', severity: 'high', detail: 'Override phrase' },
  // Role-takeover phrases.
  { re: /\byou\s+are\s+now\b/gi, kind: 'injection-phrase', severity: 'medium', detail: 'Role-takeover phrase' },
  { re: /\bact\s+as\s+(if\s+)?(a|an|the)?\s*\w+/gi, kind: 'injection-phrase', severity: 'low', detail: 'Role-assignment phrase' },
  { re: /\bpretend\s+(you\s+are|to\s+be)\b/gi, kind: 'injection-phrase', severity: 'medium', detail: 'Persona-takeover phrase' },
  // System / context-fence markers commonly used to splice in fake system messages.
  { re: /\bsystem\s*:/gi, kind: 'fence', severity: 'medium', detail: 'System role fence — could splice a fake system message' },
  { re: /\[\s*INST\s*\]|\[\s*\/\s*INST\s*\]/gi, kind: 'fence', severity: 'high', detail: 'Llama-style instruction fence' },
  { re: /<\|im_start\|>|<\|im_end\|>/gi, kind: 'fence', severity: 'high', detail: 'ChatML-style turn fence' },
  { re: /<\|endoftext\|>|<\|startoftext\|>/gi, kind: 'fence', severity: 'high', detail: 'OpenAI-style turn fence' },
  // Jailbreak names — DAN, STAN, evil-twin patterns.
  { re: /\b(do\s+anything\s+now|DAN)\b/g, kind: 'injection-phrase', severity: 'high', detail: 'Named jailbreak (DAN)' },
];

function severityRank(s: InjectionHighlight['severity']): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(text: string, highlights: InjectionHighlight[]): string {
  if (highlights.length === 0) return escapeHtml(text);
  // Sort by start. Overlapping highlights keep their natural order.
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const h of sorted) {
    if (h.start < cursor) continue; // Skip overlaps (keep first one).
    if (h.start > cursor) parts.push(escapeHtml(text.slice(cursor, h.start)));
    parts.push(
      `<mark data-kind="${h.kind}" data-severity="${h.severity}" title="${escapeHtml(h.detail)}">${escapeHtml(text.slice(h.start, h.end))}</mark>`,
    );
    cursor = h.end;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('');
}

/**
 * Convert a ConfusableHit into a highlight. Each character finding is a
 * one-codepoint span, so end = start + char.length.
 */
function highlightFromHit(hit: ConfusableHit): InjectionHighlight {
  const kind: InjectionHighlight['kind'] = hit.reason === 'invisible' ? 'invisible' : hit.reason === 'mixed-script' ? 'mixed-script' : 'confusable';
  const severity: InjectionHighlight['severity'] = hit.reason === 'invisible' ? 'high' : 'medium';
  const detail = hit.reason === 'invisible'
    ? `Invisible character U+${hit.hex} — would be hidden from a human reader`
    : `Looks like "${hit.lookalike}" but is actually ${hit.script} (U+${hit.hex})`;
  return {
    start: hit.index,
    end: hit.index + hit.char.length,
    text: hit.char,
    kind,
    severity,
    detail,
  };
}

function highlightFromMixedToken(tok: MixedScriptToken): InjectionHighlight {
  return {
    start: tok.start,
    end: tok.start + tok.token.length,
    text: tok.token,
    kind: 'mixed-script',
    severity: 'medium',
    detail: `Word mixes scripts: ${tok.scripts.join(' + ')}`,
  };
}

function highlightsFromInjection(text: string): InjectionHighlight[] {
  const out: InjectionHighlight[] = [];
  for (const p of INJECTION_PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: p.kind,
        severity: p.severity,
        detail: p.detail,
      });
      if (!p.re.global) break;
    }
  }
  return out;
}

export function analyzePromptInjection(
  text: string,
  params: PromptInjectionDemoParams = {},
): PromptInjectionDemoResult {
  const input = text ?? '';
  if (input.length === 0) {
    return {
      verdict: 'clean',
      highlights: [],
      summary: 'Empty input — nothing to analyse.',
      totals: { chars: 0, flagged: 0 },
      ...(params.includeHtml !== false ? { html: '' } : {}),
    };
  }
  const confusable = analyzeConfusable(input, { baseScript: 'latin', flagMixedScript: true });
  const highlights: InjectionHighlight[] = [
    ...confusable.hits.map(highlightFromHit),
    ...confusable.mixedScriptTokens.map(highlightFromMixedToken),
    ...highlightsFromInjection(input),
  ];

  // Dedupe by start+end+kind (mixed-script tokens can overlap with per-char hits).
  const seen = new Set<string>();
  const deduped = highlights.filter((h) => {
    const key = `${h.start}:${h.end}:${h.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Verdict = highest severity across findings (capped at confusable verdict).
  const ranks = deduped.map((h) => severityRank(h.severity));
  const maxRank = ranks.length === 0 ? 0 : Math.max(...ranks);
  const verdict: PromptInjectionDemoResult['verdict'] =
    maxRank === 0 ? 'clean' : maxRank === 1 ? 'low' : maxRank === 2 ? 'medium' : 'high';

  const summary = deduped.length === 0
    ? 'No suspicious content detected.'
    : `${deduped.length} finding${deduped.length === 1 ? '' : 's'}: ${[...new Set(deduped.map((h) => h.kind))].join(', ')}. Verdict: ${verdict}.`;

  const result: PromptInjectionDemoResult = {
    verdict,
    highlights: deduped,
    summary,
    totals: { chars: input.length, flagged: deduped.length },
  };
  if (params.includeHtml !== false) {
    result.html = renderHtml(input, deduped);
  }
  return result;
}

export const promptInjectionDemo: ToolModule<PromptInjectionDemoParams> = {
  id: 'prompt-injection-demo',
  slug: 'prompt-injection-demo',
  name: 'Prompt Injection Demo',
  description:
    'Visualise where prompt-injection content hides in text — invisible characters, confusable lookalikes (Cyrillic а vs Latin a), mixed-script words, instruction-override phrases ("ignore previous instructions"), and chat-fence markers ([INST], <|im_start|>, System:). Returns positions, severity, and HTML with <mark> spans for direct display.',
  llmDescription:
    'Take untrusted text (a PDF body, a scraped page, a copy-paste from the web), return structured findings: each highlight has a start/end offset, the matched fragment, a kind (invisible / confusable / mixed-script / injection-phrase / fence / control), a severity, and a human-readable detail. Output JSON also includes a pre-rendered HTML view with <mark> spans the UI can show directly.',
  category: 'privacy',
  keywords: ['prompt injection', 'security', 'llm', 'safety', 'suspicious', 'homoglyph', 'jailbreak', 'visualize'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultPromptInjectionDemoParams,

  paramSchema: {
    includeHtml: {
      type: 'boolean',
      label: 'include rendered HTML',
      help: 'Embed an HTML version of the input with <mark data-kind="…"> spans around each finding, for direct rendering.',
    },
  },

  async run(inputs: File[], params: PromptInjectionDemoParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('prompt-injection-demo accepts exactly one text input.');
    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Scanning for injection content' });
    const text = await inputs[0]!.text();
    const result = analyzePromptInjection(text, params);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  seoContent: {
    intro:
      'Paste any text — a scraped page, a PDF body, a chat transcript, a copy-paste from the web — and see exactly where prompt-injection content is hiding. The tool surfaces three categories in one pass: invisible characters that humans cannot see (zero-width Unicode, BOM, control codes), confusable lookalikes where one alphabet impersonates another (Cyrillic `а` masquerading as Latin `a`), and instruction-override patterns ("ignore previous instructions", `[INST]`, `<|im_start|>`, `System:`, named jailbreaks). Each finding is reported with character offsets, severity, and a rendered HTML view ready to display. Runs in your browser — never sends your text to anyone.',
    useCases: [
      'Audit text before pasting it into an LLM prompt or fine-tune dataset.',
      'Defensive scan of scraped pages, PDFs, or user-submitted content fed to an agent.',
      'Demo prompt-injection risk to a team that hasn\'t internalised the threat model.',
      'Catch homoglyph attacks in URLs, account names, or imported user data.',
      'Spot zero-width characters in payment-form values or address fields where they\'re used to bypass filters.',
    ],
    faq: [
      {
        q: 'What counts as a "prompt injection"?',
        a: 'Any content embedded in untrusted text designed to alter an LLM\'s behaviour: explicit overrides ("ignore previous instructions"), role-takeover phrases ("you are now"), chat fences from common templates (ChatML `<|im_start|>`, Llama `[INST]`, OpenAI), `System:` role spoofing, and named jailbreaks (DAN). The tool also catches non-instructional but high-risk content: invisible characters (zero-width Unicode) and confusable lookalikes that bypass naïve string filters.',
      },
      {
        q: 'Will it catch every attack?',
        a: 'No — this is a heuristic over known classes. Novel attacks worded differently from the pattern table will slip past. Use it as one defensive layer, not as the only one. The output is structured enough that you can plug it into your own ranking / blocking pipeline.',
      },
      {
        q: 'Does it work on PDFs?',
        a: 'Run `pdf-to-text` first, then pipe the output into prompt-injection-demo. The Wyreup chain builder makes that two-step flow a one-click chain.',
      },
      {
        q: 'Can I get the HTML render directly?',
        a: 'Yes — the JSON output includes an `html` field with `<mark data-kind="…" data-severity="…">` spans around each finding. Drop it into a `<div>` to render the marked-up text inline.',
      },
    ],
    alsoTry: [
      { id: 'text-suspicious', why: 'Get the verdict layer (clean / low / medium / high) without the per-character highlights.' },
      { id: 'pdf-suspicious', why: 'Same idea, but extracts text from a PDF first.' },
      { id: 'text-confusable', why: 'Just the homoglyph / mixed-script analyser without the prompt-injection patterns.' },
    ],
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
