// Share links for hosted PRO text results. See migrations/0009_shared_results.sql.

import type { D1Database, D1PreparedStatement } from './env';

export const SHARE_TTL_MS = 30 * 24 * 3600_000;
export const SHARE_MAX_ACTIVE = 20;
export const SHARE_MAX_CHARS = 100_000;
/**
 * Each link uses up one paid run of the tool from this window. The run stays
 * used after the link is deleted, so every stored link was paid for.
 */
export const SHARE_RECENT_RUN_MS = 24 * 3600_000;
/** Links created per account per rolling 24 hours, deleted ones included. */
export const SHARE_MAX_CREATES_PER_DAY = 10;
/** Creation records older than this cannot affect a limit and are dropped. */
export const SHARE_CREATION_RECORD_MS = 2 * SHARE_RECENT_RUN_MS;
/** Rows removed per cleanup pass, so one request never does unbounded work. */
export const SHARE_CLEANUP_BATCH = 50;
/** Public page views per client IP per minute, per Functions isolate. */
export const SHARE_VIEWS_PER_MINUTE = 60;
const VIEW_LIMITER_MAX_KEYS = 10_000;

/**
 * Bounded removal of expired links (anyone's) and of creation records too old
 * to matter. Run inside the batch of every create, list and delete.
 */
export function shareCleanupStatements(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `DELETE FROM shared_results WHERE id IN
           (SELECT id FROM shared_results WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`,
      )
      .bind(now, SHARE_CLEANUP_BATCH),
    db
      .prepare(
        `DELETE FROM share_creations WHERE run_id IN
           (SELECT run_id FROM share_creations WHERE created_at < ? ORDER BY created_at LIMIT ?)`,
      )
      .bind(now - SHARE_CREATION_RECORD_MS, SHARE_CLEANUP_BATCH),
  ];
}

// Fixed one-minute windows keyed by client IP. In memory, so this bounds the
// database reads one isolate makes; it is not a global limit across isolates.
const viewWindows = new Map<string, { start: number; count: number }>();

/** Seconds to wait if this view is over the limit, else 0 (and counts it). */
export function shareViewRetryAfter(ip: string, now: number): number {
  const start = now - (now % 60_000);
  const wait = Math.max(1, Math.ceil((start + 60_000 - now) / 1000));
  const entry = viewWindows.get(ip);
  if (entry && entry.start === start) {
    if (entry.count >= SHARE_VIEWS_PER_MINUTE) return wait;
    entry.count++;
    return 0;
  }
  if (!entry && viewWindows.size >= VIEW_LIMITER_MAX_KEYS) {
    for (const [key, value] of viewWindows) if (value.start !== start) viewWindows.delete(key);
    if (viewWindows.size >= VIEW_LIMITER_MAX_KEYS) return wait;
  }
  viewWindows.set(ip, { start, count: 1 });
  return 0;
}

/** Test hook: forget all view windows. */
export function resetShareViewLimiter(): void {
  viewWindows.clear();
}

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
