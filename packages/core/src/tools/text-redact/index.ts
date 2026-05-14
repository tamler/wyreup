import type { ToolModule, ToolRunContext } from '../../types.js';

export type RedactPreset =
  | 'email'
  | 'phone-us'
  | 'phone-intl'
  | 'ssn'
  | 'credit-card'
  | 'ipv4'
  | 'ipv6'
  | 'url'
  | 'uuid'
  | 'aws-access-key';

export interface TextRedactParams {
  /** Categories to redact. */
  presets?: RedactPreset[];
  /** What to replace matches with. `[REDACTED]` is the default. */
  replacement?: string;
  /** Additional comma-separated regex patterns (no flags). */
  customPatterns?: string;
}

export const defaultTextRedactParams: TextRedactParams = {
  presets: ['email', 'phone-us', 'ssn', 'credit-card'],
  replacement: '[REDACTED]',
  customPatterns: '',
};

export interface TextRedactResult {
  redactedText: string;
  counts: Partial<Record<RedactPreset | 'custom', number>>;
  totalRedactions: number;
}

// Pattern table. Order matters — credit-card before ssn so 16-digit
// runs aren't first-matched as a fragmentary SSN.
const PATTERNS: ReadonlyArray<{ key: RedactPreset; re: RegExp }> = [
  // Email
  { key: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Credit cards — 13-19 digit runs with optional spaces or dashes, Luhn-checked at apply time.
  { key: 'credit-card', re: /\b(?:\d[ -]?){12,18}\d\b/g },
  // US SSN — 3-2-4 form. Must be word-bounded.
  { key: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // US phone with optional country code and various separators.
  { key: 'phone-us', re: /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g },
  // International phone — +CC then 6-14 digits with optional spaces.
  { key: 'phone-intl', re: /\+\d{1,3}[ .-]?\d{1,4}[ .-]?\d{4,}/g },
  // IPv4
  { key: 'ipv4', re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g },
  // IPv6 — common compressed and full forms. Not exhaustive.
  { key: 'ipv6', re: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g },
  // URL
  { key: 'url', re: /\bhttps?:\/\/[^\s<>"'`]+/g },
  // UUID
  { key: 'uuid', re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g },
  // AWS access key (AKIA prefix + 16 uppercase alphanumeric)
  { key: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
];

function passesLuhn(digits: string): boolean {
  const d = digits.replace(/[^\d]/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i]!, 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactText(input: string, params: TextRedactParams): TextRedactResult {
  const presets = new Set(params.presets ?? defaultTextRedactParams.presets!);
  const replacement = params.replacement ?? '[REDACTED]';

  const counts: TextRedactResult['counts'] = {};
  let totalRedactions = 0;
  let text = input;

  for (const { key, re } of PATTERNS) {
    if (!presets.has(key)) continue;
    if (key === 'credit-card') {
      // Luhn-validate to avoid redacting unrelated 13-19 digit runs.
      text = text.replace(re, (match) => {
        if (!passesLuhn(match)) return match;
        counts['credit-card'] = (counts['credit-card'] ?? 0) + 1;
        totalRedactions++;
        return replacement;
      });
    } else {
      text = text.replace(re, () => {
        counts[key] = (counts[key] ?? 0) + 1;
        totalRedactions++;
        return replacement;
      });
    }
  }

  const customRaw = (params.customPatterns ?? '').trim();
  if (customRaw) {
    const patterns = customRaw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const pat of patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pat, 'g');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Custom pattern "${pat}" is invalid: ${msg}`);
      }
      text = text.replace(re, () => {
        counts.custom = (counts.custom ?? 0) + 1;
        totalRedactions++;
        return replacement;
      });
    }
  }

  return { redactedText: text, counts, totalRedactions };
}

export const textRedact: ToolModule<TextRedactParams> = {
  id: 'text-redact',
  slug: 'text-redact',
  name: 'Text Redact',
  description:
    'Replace PII patterns in text — emails, phones, SSNs, credit cards (Luhn-validated), IPs, URLs, UUIDs, AWS access keys. Optional custom regex patterns. Text-only sibling of pdf-redact.',
  category: 'privacy',
  keywords: ['redact', 'pii', 'privacy', 'sanitize', 'mask', 'email', 'phone', 'ssn', 'credit-card', 'security'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextRedactParams,

  paramSchema: {
    presets: {
      type: 'multi-enum',
      label: 'redact',
      options: [
        { value: 'email', label: 'emails' },
        { value: 'phone-us', label: 'US phone numbers' },
        { value: 'phone-intl', label: 'international phone numbers' },
        { value: 'ssn', label: 'US SSNs (NNN-NN-NNNN)' },
        { value: 'credit-card', label: 'credit cards (Luhn-validated)' },
        { value: 'ipv4', label: 'IPv4 addresses' },
        { value: 'ipv6', label: 'IPv6 addresses' },
        { value: 'url', label: 'URLs' },
        { value: 'uuid', label: 'UUIDs' },
        { value: 'aws-access-key', label: 'AWS access keys' },
      ],
    },
    replacement: {
      type: 'string',
      label: 'replacement',
      placeholder: '[REDACTED]',
    },
    customPatterns: {
      type: 'string',
      label: 'custom patterns',
      help: 'Comma-separated JavaScript regex patterns (without /…/g — the g flag is added automatically).',
      placeholder: '\\bpassword[\\s:=]+\\S+\\b, \\bAPI_KEY=\\S+',
    },
  },

  async run(inputs: File[], params: TextRedactParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('text-redact accepts exactly one text input.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading text' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Redacting' });
    const result = redactText(text, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([result.redactedText], { type: 'text/plain' }),
      new Blob([JSON.stringify({ counts: result.counts, totalRedactions: result.totalRedactions }, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'application/json'],
  },
};
