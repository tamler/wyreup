import type { ToolModule, ToolRunContext } from '../../types.js';
import { analyzeConfusable } from '../text-confusable/index.js';

export interface TextSuspiciousParams {
  /** Threshold for invisible-character density (fraction of total chars). */
  invisibleDensityThreshold?: number;
  /** Maximum fraction of non-ASCII characters before "non-ASCII heavy" fires. */
  nonAsciiThreshold?: number;
  /** Minimum confusables before "confusable injection" fires. */
  confusableThreshold?: number;
}

export const defaultTextSuspiciousParams: TextSuspiciousParams = {
  invisibleDensityThreshold: 0.001,
  nonAsciiThreshold: 0.5,
  confusableThreshold: 1,
};

export interface SuspiciousFinding {
  kind: 'invisible-injection' | 'mixed-script' | 'confusable' | 'non-ascii-heavy' | 'control-chars' | 'bom';
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface TextSuspiciousResult {
  verdict: 'clean' | 'low' | 'medium' | 'high';
  findings: SuspiciousFinding[];
  totals: {
    chars: number;
    invisible: number;
    nonAscii: number;
    confusables: number;
    mixedScriptTokens: number;
  };
}

const SEVERITY_RANK: Record<SuspiciousFinding['severity'], number> = { low: 1, medium: 2, high: 3 };
const VERDICT_BY_RANK: TextSuspiciousResult['verdict'][] = ['clean', 'low', 'medium', 'high'];

export function analyzeSuspicious(text: string, params: TextSuspiciousParams): TextSuspiciousResult {
  const invisibleDensity = params.invisibleDensityThreshold ?? 0.001;
  const nonAsciiThreshold = params.nonAsciiThreshold ?? 0.5;
  const confusableThreshold = params.confusableThreshold ?? 1;

  // Lean on text-confusable's analyzer for the heavy lifting; this tool is
  // the editorial verdict layer on top.
  const conf = analyzeConfusable(text, { baseScript: 'latin', flagMixedScript: true });

  // Inline BOM + control detection — analyzeConfusable doesn't expose those
  // separately, so walk the text once for the additional signals.
  let nonAscii = 0;
  let hasBom = false;
  let hasControls = false;
  let index = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x7f) nonAscii++;
    if (cp === 0xfeff && index === 0) hasBom = true;
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) hasControls = true;
    if (cp >= 0x7f && cp < 0xa0) hasControls = true;
    index++;
  }

  const findings: SuspiciousFinding[] = [];
  if (hasBom) {
    findings.push({
      kind: 'bom',
      severity: 'low',
      detail: 'Byte-order mark (U+FEFF) at start of text — common in Windows tools, harmless but worth noting.',
    });
  }
  if (conf.invisibleCount > 0) {
    const density = conf.totalChars > 0 ? conf.invisibleCount / conf.totalChars : 0;
    const severity: SuspiciousFinding['severity'] = density >= invisibleDensity * 10 ? 'high' : density >= invisibleDensity ? 'medium' : 'low';
    findings.push({
      kind: 'invisible-injection',
      severity,
      detail: `${conf.invisibleCount} invisible character(s) (zero-width / RTL marks / soft hyphens) at density ${(density * 100).toFixed(2)}% of the document. Common in prompt-injection and copy-paste attacks.`,
    });
  }
  if (conf.confusableCount >= confusableThreshold) {
    findings.push({
      kind: 'confusable',
      severity: conf.confusableCount >= 5 ? 'high' : 'medium',
      detail: `${conf.confusableCount} non-Latin lookalike(s) — Cyrillic а / Greek ο / fullwidth Latin etc. used in IDN spoofing.`,
    });
  }
  if (conf.mixedScriptTokens.length > 0) {
    findings.push({
      kind: 'mixed-script',
      severity: 'high',
      detail: `${conf.mixedScriptTokens.length} mixed-script token(s): ${conf.mixedScriptTokens.slice(0, 5).map((t) => `"${t.token}" (${t.scripts.join('+')})`).join(', ')}.`,
    });
  }
  if (hasControls) {
    findings.push({
      kind: 'control-chars',
      severity: 'medium',
      detail: 'Contains C0 / C1 control characters (other than common whitespace).',
    });
  }
  if (conf.totalChars > 0 && nonAscii / conf.totalChars > nonAsciiThreshold) {
    const expectedLatin = ['latin', 'Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A', 'Latin Extended-B'];
    const dominantNonLatin = conf.scripts.filter((s) => !expectedLatin.includes(s));
    if (dominantNonLatin.length > 0) {
      // Pure non-Latin text is legitimate (Cyrillic Russian, Greek Greek, etc.).
      // Only flag if we ALSO had confusable or mixed-script hits — that's the
      // pattern that indicates Latin spoofing.
      if (conf.confusableCount > 0 || conf.mixedScriptTokens.length > 0) {
        findings.push({
          kind: 'non-ascii-heavy',
          severity: 'medium',
          detail: `${(nonAscii / conf.totalChars * 100).toFixed(1)}% non-ASCII alongside Latin-confusable hits — likely spoofing rather than legitimate non-Latin content.`,
        });
      }
    }
  }

  const peak = findings.reduce((max, f) => Math.max(max, SEVERITY_RANK[f.severity]), 0);
  const verdict = VERDICT_BY_RANK[peak]!;

  return {
    verdict,
    findings,
    totals: {
      chars: conf.totalChars,
      invisible: conf.invisibleCount,
      nonAscii,
      confusables: conf.confusableCount,
      mixedScriptTokens: conf.mixedScriptTokens.length,
    },
  };
}

export const textSuspicious: ToolModule<TextSuspiciousParams> = {
  id: 'text-suspicious',
  slug: 'text-suspicious',
  name: 'Text Suspicious',
  description:
    'Single security verdict on a block of text. Combines text-confusable\'s homoglyph / mixed-script detection with checks for invisible-character density, control characters, BOM markers, and non-ASCII heaviness. Returns a verdict (clean / low / medium / high) with the contributing findings — the "should I trust this prompt-injection-shaped message" tool.',
  category: 'inspect',
  keywords: ['suspicious', 'security', 'prompt-injection', 'confusable', 'invisible', 'audit', 'safety'],

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

  defaults: defaultTextSuspiciousParams,

  paramSchema: {
    invisibleDensityThreshold: {
      type: 'number',
      label: 'invisible density threshold',
      help: 'Above this fraction of invisibles relative to total chars, fire a medium severity flag. 10x is high.',
      min: 0,
      max: 0.1,
      step: 0.0001,
    },
    nonAsciiThreshold: {
      type: 'number',
      label: 'non-ASCII threshold',
      help: 'Fraction of non-ASCII chars before "spoofing-shaped non-ASCII heavy" fires (only when paired with confusable / mixed-script hits).',
      min: 0,
      max: 1,
      step: 0.05,
    },
    confusableThreshold: {
      type: 'number',
      label: 'confusable threshold',
      min: 0,
      max: 100,
      step: 1,
    },
  },

  async run(inputs: File[], params: TextSuspiciousParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('text-suspicious accepts exactly one text input.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading text' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Analyzing' });
    const result = analyzeSuspicious(text, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
