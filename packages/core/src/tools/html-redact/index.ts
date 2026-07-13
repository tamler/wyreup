import type { ToolModule, ToolRunContext } from '../../types.js';
import {
  redactText,
  defaultTextRedactParams,
  type TextRedactParams,
  type TextRedactResult,
} from '../text-redact/index.js';

export type HtmlRedactParams = TextRedactParams;

export const defaultHtmlRedactParams: HtmlRedactParams = { ...defaultTextRedactParams };

export interface HtmlRedactResult {
  counts: TextRedactResult['counts'];
  totalRedactions: number;
}

// Redact PII in the visible text of an HTML document while leaving every
// tag and attribute intact. Dependency-free: the markup is tokenized into
// tags and the text between them; redaction runs only on text segments,
// and never inside <script>/<style>. Attribute values are not touched.
function redactHtml(
  html: string,
  params: HtmlRedactParams,
): { html: string; counts: TextRedactResult['counts']; totalRedactions: number } {
  const TAG_RE = /<[^>]+>/g;
  const counts: TextRedactResult['counts'] = {};
  let total = 0;
  let out = '';
  let lastIndex = 0;
  let skip = false; // inside <script> or <style>

  const apply = (segment: string): void => {
    if (!segment) return;
    if (skip) {
      out += segment;
      return;
    }
    const r = redactText(segment, params);
    out += r.redactedText;
    total += r.totalRedactions;
    for (const [k, v] of Object.entries(r.counts)) {
      const key = k as keyof TextRedactResult['counts'];
      counts[key] = (counts[key] ?? 0) + (v ?? 0);
    }
  };

  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    apply(html.slice(lastIndex, m.index));
    const tag = m[0];
    out += tag;
    if (/^<\s*(script|style)[\s/>]/i.test(tag)) skip = true;
    else if (/^<\s*\/\s*(script|style)\s*>/i.test(tag)) skip = false;
    lastIndex = TAG_RE.lastIndex;
  }
  apply(html.slice(lastIndex));

  return { html: out, counts, totalRedactions: total };
}

export const htmlRedact: ToolModule<HtmlRedactParams> = {
  id: 'html-redact',
  slug: 'html-redact',
  name: 'HTML Redact',
  description:
    'Redact emails, phone numbers, SSNs, cards and more from the visible text of an HTML file — every tag and attribute is left intact. The structure-aware counterpart to Text Redact.',
  category: 'privacy',
  keywords: ['html', 'redact', 'pii', 'privacy', 'sanitize', 'mask'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: {
    mime: 'text/html',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  chainSuggestions: ['html-to-markdown', 'html-minify', 'html-formatter', 'html-clean'],
  defaults: defaultHtmlRedactParams,

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
      help: 'Comma-separated JavaScript regex patterns (the g flag is added automatically).',
      placeholder: '\\bpassword[\\s:=]+\\S+\\b',
    },
  },

  async run(inputs: File[], params: HtmlRedactParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('html-redact accepts exactly one HTML file.');

    ctx.onProgress({ stage: 'processing', percent: 35, message: 'Reading HTML' });
    const html = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 65, message: 'Redacting text content' });
    const { html: redacted, counts, totalRedactions } = redactHtml(html, params);

    const stats: HtmlRedactResult = { counts, totalRedactions };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([redacted], { type: 'text/html' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/html', 'application/json'],
  },
};
