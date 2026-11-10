// Share links for hosted PRO text results. See migrations/0009_shared_results.sql.

export const SHARE_TTL_MS = 30 * 24 * 3600_000;
export const SHARE_MAX_ACTIVE = 20;
export const SHARE_MAX_CHARS = 100_000;
/** The owner must have run the tool this recently; ties a link to real PRO use. */
export const SHARE_RECENT_RUN_MS = 24 * 3600_000;

/** Hosted tools whose result is plain text, with the label the public page shows. */
export const SHAREABLE_TOOLS: Readonly<Record<string, string>> = {
  'ocr-hq': 'High-accuracy OCR',
  'read-handwriting': 'Read Handwriting',
  'transcribe-pro': 'Hosted transcription',
  'text-translate-pro': 'Hosted translation',
  'translate-document-pro': 'Translate a Document',
  'pdf-q-and-a': 'Ask a PDF',
  'pdf-summarize': 'Summarize PDF',
  'text-summarize-pro': 'Hosted summary',
};

export function shareLinksEnabled(env: { SHARE_LINKS_ENABLED?: string }): boolean {
  return env.SHARE_LINKS_ENABLED === '1';
}

export function isShareId(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

/** 22 URL-safe characters from 16 random bytes (128 bits). */
export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
