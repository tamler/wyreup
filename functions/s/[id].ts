// GET /s/:id  public, read-only view of a shared PRO text result.
//
// Static _headers rules do not apply to Function responses, so this sets its
// own CSP. The page carries no script, is not indexed, and escapes the body.
// It is never stored by browsers or caches (no-store), so a deleted, expired
// or disabled link stops showing on the next request.

import type { Env } from '../_lib/env';
import type { PagesFunction } from '../_lib/types';
import { appOrigin } from '../_lib/env';
import {
  escapeHtml,
  isShareId,
  SHAREABLE_TOOLS,
  shareLinksEnabled,
  shareViewRetryAfter,
} from '../_lib/shares';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const STYLE = `
  :root { color-scheme: light dark; --bg: #fafaf7; --fg: #1d1d1b; --muted: #5f5f5a; --line: #deded8; --accent: #2b5fd9; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141413; --fg: #ededea; --muted: #a3a39d; --line: #33332f; --accent: #8fb0ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 0.875rem; margin: 0 0 20px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 0; }
  .note { color: var(--muted); font-size: 0.8125rem; margin: 16px 0 0; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 0.875rem; color: var(--muted); }
  a { color: var(--accent); }
`;

function page(title: string, content: string, status: number, extra: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${content}</main></body></html>`;
  return new Response(html, { status, headers: { ...HEADERS, ...extra } });
}

function tooMany(origin: string, retryAfter: number): Response {
  return page(
    'Too many requests',
    `<h1>Too many requests</h1>
<p class="meta">Wait a minute and reload the page.</p>
<footer><a href="${origin}/">Go to Wyreup</a></footer>`,
    429,
    { 'Retry-After': String(retryAfter) },
  );
}

function notFound(origin: string): Response {
  return page(
    'Link not available',
    `<h1>This link is not available</h1>
<p class="meta">It may have expired or been deleted by the person who shared it.</p>
<footer><a href="${origin}/">Go to Wyreup</a></footer>`,
    404,
  );
}

const date = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const origin = appOrigin(env);
  const id = typeof params.id === 'string' ? params.id : '';
  if (!shareLinksEnabled(env) || !isShareId(id)) return notFound(origin);

  const now = Date.now();
  const retryAfter = shareViewRetryAfter(request.headers.get('CF-Connecting-IP') ?? 'unknown', now);
  if (retryAfter > 0) return tooMany(origin, retryAfter);

  const row = await env.DB.prepare(
    `SELECT tool_id, body, created_at, expires_at FROM shared_results WHERE id = ?`,
  )
    .bind(id)
    .first<{ tool_id: string; body: string; created_at: number; expires_at: number }>();
  if (!row) return notFound(origin);
  if (row.expires_at <= now) {
    // Someone asked for an expired link: delete it now rather than wait for a sweep.
    await env.DB.prepare(`DELETE FROM shared_results WHERE id = ? AND expires_at <= ?`).bind(id, now).run();
    return notFound(origin);
  }

  const label = SHAREABLE_TOOLS[row.tool_id] ?? 'Wyreup result';
  const toolUrl = `${origin}/tools/${encodeURIComponent(row.tool_id)}/`;
  return page(
    `${label} result shared from Wyreup`,
    `<h1>${escapeHtml(label)} result</h1>
<p class="meta">Shared on ${date(row.created_at)}. This link expires on ${dateTime(row.expires_at)}, and Wyreup then deletes the text.</p>
<pre>${escapeHtml(row.body)}</pre>
<p class="note">A Wyreup user shared this. Wyreup did not write or review it.</p>
<footer>Made with Wyreup. <a href="${toolUrl}">Try ${escapeHtml(label)}</a> or <a href="${origin}/">see the free tools</a>.</footer>`,
    200,
  );
};
