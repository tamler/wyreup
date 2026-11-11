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
    benefit: 'Reads hard-to-read scans, skewed photos and unusual fonts more reliably.',
  },
  {
    freeToolId: 'transcribe',
    proToolId: 'transcribe-pro',
    benefit: 'More accurate transcription of accented or noisy speech, for files up to 25 MB.',
  },
  {
    freeToolId: 'upscale-2x',
    proToolId: 'upscale-2x-pro',
    benefit: 'Enlargement on a hosted GPU model.',
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
    freeToolId: 'pdf-to-text',
    proToolId: 'pdf-q-and-a',
    benefit: 'Ask a specific question and get an answer drawn from the document text.',
  },
  {
    freeToolId: 'text-summarize',
    proToolId: 'text-summarize-pro',
    benefit: 'Summaries from a hosted language model that hold up on long or messy text.',
  },
  {
    freeToolId: 'text-translate',
    proToolId: 'text-translate-pro',
    benefit: 'More natural phrasing from a hosted language model, especially for less common language pairs.',
  },
  {
    freeToolId: 'text-redact',
    proToolId: 'text-redact-pro',
    benefit: 'Catches names, addresses, and identifiers the pattern-based redactor misses.',
  },
];

/** First pairing for a free tool — the single post-run seam. */
export function upsellFor(freeToolId: string): ProUpsell | undefined {
  return PRO_UPSELLS.find((u) => u.freeToolId === freeToolId);
}

/** Every pairing for a free tool, in list order — the tool-page prompt. */
export function upsellsFor(freeToolId: string): ProUpsell[] {
  return PRO_UPSELLS.filter((u) => u.freeToolId === freeToolId);
}

// Hosted tools that extract a document's text in the browser and send only
// that text (each calls runPro with `text`, never the file bytes).
const SENDS_EXTRACTED_TEXT = new Set([
  'pdf-q-and-a',
  'pdf-summarize',
  'chat-long-pdf-pro',
  'translate-document-pro',
]);

// Of those, the question-answering tools also send the question.
const SENDS_QUESTION = new Set(['pdf-q-and-a', 'chat-long-pdf-pro']);

/** What a hosted tool sends to Wyreup, for privacy copy ("… is sent"). */
export function hostedInputPhrase(toolId: string): string {
  if (!SENDS_EXTRACTED_TEXT.has(toolId)) return 'your input';
  const text = 'the text extracted from your file in this browser';
  return SENDS_QUESTION.has(toolId) ? `${text}, and your question,` : text;
}
