// Server-authoritative price table for PRO tools.
// The client also exposes `creditCost` on tool registry entries for UI, but
// the server NEVER trusts that value — every PRO run looks up the cost here.
//
// Keep in sync with the table in docs/pro-auth-spec.md §2 and the registry
// entries in @wyreup/core.

export const PRICING: Readonly<Record<string, number>> = {
  'transcribe-pro': 3,
  'text-summarize-pro': 2,
  'text-translate-pro': 2,
  'text-sentiment-pro': 1,
  'text-ner-pro': 1,
  'bg-remove-pro': 3,
  'upscale-2x-pro': 3,
  'text-redact-pro': 2,
  'ocr-hq': 1,
  'image-describe': 1,
  'analyze-chart': 1,
  'image-q-and-a': 1,
  'read-handwriting': 1,
  'detect-objects': 1,
  'translate-image': 2,
  'transcribe-and-translate': 5,
  'regex-from-text-pro': 1,
  'cron-from-text-pro': 1,
};

export function priceFor(toolId: string): number | null {
  return Object.prototype.hasOwnProperty.call(PRICING, toolId) ? PRICING[toolId] : null;
}
