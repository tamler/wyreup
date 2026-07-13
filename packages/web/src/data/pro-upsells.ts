export interface ProUpsell {
  freeToolId: string;
  proToolId: string;
  benefit: string;
}

/**
 * Free tools with a hosted sibling. Every id verified against the default
 * registry (`packages/core` tool modules).
 */
export const PRO_UPSELLS: ProUpsell[] = [
  {
    freeToolId: 'ocr',
    proToolId: 'ocr-hq',
    benefit:
      'Higher-accuracy text reading — better with hard-to-read scans and handwriting.',
  },
  {
    freeToolId: 'transcribe',
    proToolId: 'transcribe-pro',
    benefit:
      'Higher-accuracy transcription — better with accents, noise, and long recordings.',
  },
  {
    freeToolId: 'upscale-2x',
    proToolId: 'upscale-2x-pro',
    benefit: 'Production-quality enlargement from our servers.',
  },
  {
    freeToolId: 'bg-remove',
    proToolId: 'bg-remove-pro',
    benefit: 'Precision background removal for hair and fine edges.',
  },
  {
    freeToolId: 'pdf-to-text',
    proToolId: 'pdf-summarize',
    benefit: 'Summarize the document instead of just extracting it.',
  },
  {
    freeToolId: 'text-summarize',
    proToolId: 'text-summarize-pro',
    benefit: 'Frontier-model summaries that hold up on long or messy text.',
  },
  {
    freeToolId: 'text-translate',
    proToolId: 'text-translate-pro',
    benefit: 'Natural-sounding translation across 100+ languages, not phrasebook output.',
  },
  {
    freeToolId: 'text-redact',
    proToolId: 'text-redact-pro',
    benefit: 'Catches names, addresses, and identifiers the pattern-based redactor misses.',
  },
  {
    freeToolId: 'pdf-redact',
    proToolId: 'text-redact-pro',
    benefit: 'Catches names, addresses, and identifiers that simple patterns miss.',
  },
];

export function upsellFor(freeToolId: string): ProUpsell | undefined {
  return PRO_UPSELLS.find((u) => u.freeToolId === freeToolId);
}
