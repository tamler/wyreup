// Server-authoritative price table for PRO tools.
// The client also exposes `creditCost` on tool registry entries for UI, but
// the server NEVER trusts that value — every PRO run looks up the cost here.
//
// Keep in sync with the table in docs/pro-auth-spec.md §2 and the registry
// entries in @wyreup/core.

export const PRICING: Readonly<Record<string, number>> = {
  'transcribe-pro': 5,
  'text-summarize-pro': 3,
  'text-translate-pro': 3,
  'text-sentiment-pro': 2,
  'text-ner-pro': 2,
  'bg-remove-pro': 4,
  'upscale-2x-pro': 4,
  'text-redact-pro': 3,
  'ocr-hq': 2,
  'image-describe': 2,
  'analyze-chart': 2,
  'image-q-and-a': 2,
  'read-handwriting': 2,
  'detect-objects': 1,
  'translate-image': 3,
};

export function priceFor(toolId: string): number | null {
  return Object.prototype.hasOwnProperty.call(PRICING, toolId) ? PRICING[toolId] : null;
}
